const MAX_BODY_BYTES = 524_288
const MAX_LOG_BYTES = 65_536
const encoder = new TextEncoder()

const INSERT_FEEDBACK = `
  INSERT INTO feedback (id, created_at, ip_hash, message, logs)
  SELECT ?1, ?2, ?3, ?4, ?5
  WHERE (SELECT COUNT(*) FROM feedback
         WHERE ip_hash = ?3 AND created_at > ?6) < 3
    AND (SELECT COUNT(*) FROM feedback
         WHERE created_at >= ?7 AND created_at < ?8) < 1000
`

function json(body, status = 200, headers = {}) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', ...headers },
  })
}

function error(code, status, headers) {
  return json({ error: code }, status, headers)
}

function configured(env) {
  return (
    ['TURNSTILE_SITE_KEY', 'TURNSTILE_ACTION', 'TURNSTILE_SECRET_KEY', 'IP_HASH_SECRET'].every(
      (key) => typeof env[key] === 'string' && env[key].trim().length > 0,
    ) && Boolean(env.DB)
  )
}

class BodyError extends Error {
  constructor(status) {
    super('Invalid request body')
    this.status = status
  }
}

async function readBody(request) {
  const length = request.headers.get('Content-Length')
  if (length !== null && Number(length) > MAX_BODY_BYTES) {
    throw new BodyError(413)
  }
  if (!request.body) throw new BodyError(400)

  const reader = request.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const parts = []
  let bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {})
        throw new BodyError(413)
      }
      parts.push(decoder.decode(value, { stream: true }))
    }
    parts.push(decoder.decode())
    return parts.join('')
  } catch (cause) {
    if (cause instanceof BodyError) throw cause
    await reader.cancel().catch(() => {})
    throw new BodyError(400)
  } finally {
    reader.releaseLock()
  }
}

async function verify(token, hostname, env) {
  const controller = new AbortController()
  let timer
  try {
    // Bound both the response headers and JSON body, even if an upstream stalls.
    return await Promise.race([
      (async () => {
        const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
          method: 'POST',
          body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token }),
          signal: controller.signal,
        })
        if (!response.ok) return 503
        const result = await response.json()
        if (
          result === null ||
          Array.isArray(result) ||
          typeof result !== 'object' ||
          typeof result.success !== 'boolean'
        )
          return 503
        return result.success === true && result.hostname === hostname && result.action === env.TURNSTILE_ACTION
          ? 200
          : 403
      })(),
      new Promise((resolve) => {
        timer = setTimeout(() => {
          controller.abort()
          resolve(503)
        }, 10_000)
      }),
    ])
  } catch {
    return 503
  } finally {
    clearTimeout(timer)
  }
}

async function hashIp(ip, secret) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ])
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(ip))
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function submit(request, env, url) {
  if (request.headers.get('Origin') !== url.origin) return error('invalid_origin', 403)
  const mediaType = request.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase()
  if (mediaType !== 'application/json') return error('unsupported_media_type', 415)

  let body
  try {
    body = JSON.parse(await readBody(request))
  } catch (cause) {
    return cause instanceof BodyError && cause.status === 413
      ? error('payload_too_large', 413)
      : error('invalid_request', 400)
  }
  if (
    body === null ||
    Array.isArray(body) ||
    typeof body !== 'object' ||
    typeof body.message !== 'string' ||
    typeof body.turnstileToken !== 'string' ||
    (body.logs !== undefined && typeof body.logs !== 'string')
  ) {
    return error('invalid_request', 400)
  }
  const message = body.message.trim()
  const logs = body.logs ?? ''
  if (
    message.length < 1 ||
    message.length > 4_000 ||
    body.turnstileToken.length < 1 ||
    body.turnstileToken.length > 2_048
  ) {
    return error('invalid_request', 400)
  }
  if (encoder.encode(logs).byteLength > MAX_LOG_BYTES) return error('payload_too_large', 413)

  const ip = request.headers.get('CF-Connecting-IP')
  if (!configured(env) || !ip?.trim()) return error('unavailable', 503)

  const verified = await verify(body.turnstileToken, url.hostname, env)
  if (verified !== 200) {
    return verified === 403 ? error('verification_failed', 403) : error('unavailable', 503)
  }

  try {
    const ipHash = await hashIp(ip, env.IP_HASH_SECRET)
    const now = Math.floor(Date.now() / 1_000)
    const dayStart = Math.floor(now / 86_400) * 86_400
    const result = await env.DB.prepare(INSERT_FEEDBACK)
      .bind(crypto.randomUUID(), now, ipHash, message, logs, now - 3_600, dayStart, dayStart + 86_400)
      .run()
    if (!result.success) return error('unavailable', 503)
    if (result.meta.changes === 0) return error('rate_limited', 429)
    if (result.meta.changes !== 1) return error('unavailable', 503)
    return json({ ok: true }, 201)
  } catch {
    return error('unavailable', 503)
  }
}

// The editor opens this page with a cross-site form POST carrying its recent logs. Nothing is stored here;
// the logs are only placed in the page for the user to review, redact, or exclude before sending.
async function prefillLogs(request, env, url) {
  const mediaType = request.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase()
  if (mediaType !== 'application/x-www-form-urlencoded') return error('unsupported_media_type', 415)

  let logs
  try {
    // Form submission sends CRLF line breaks; the textarea would normalize them the same way.
    logs = (new URLSearchParams(await readBody(request)).get('logs') ?? '').replace(/\r\n?/g, '\n')
  } catch (cause) {
    return cause instanceof BodyError && cause.status === 413
      ? error('payload_too_large', 413)
      : error('invalid_request', 400)
  }
  if (encoder.encode(logs).byteLength > MAX_LOG_BYTES) return error('payload_too_large', 413)

  const page = await env.ASSETS.fetch(new Request(new URL('/', url)))
  if (!page.ok) return page
  return new HTMLRewriter()
    .on('#logs-preview', {
      element(element) {
        // Escaped as text. HTML parsing drops one newline right after <textarea>, so a leading newline survives.
        element.setInnerContent(`\n${logs}`)
      },
    })
    .transform(
      new Response(page.body, {
        headers: { 'Content-Type': page.headers.get('Content-Type') ?? 'text/html', 'Cache-Control': 'no-store' },
      }),
    )
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === '/api/config') {
      if (request.method !== 'GET') return error('method_not_allowed', 405, { Allow: 'GET' })
      if (!configured(env)) return error('unavailable', 503)
      return json({ siteKey: env.TURNSTILE_SITE_KEY, action: env.TURNSTILE_ACTION })
    }
    if (url.pathname === '/api/feedback') {
      if (request.method !== 'POST') return error('method_not_allowed', 405, { Allow: 'POST' })
      return submit(request, env, url)
    }
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return error('not_found', 404)
    if (url.pathname === '/' && request.method === 'POST') return prefillLogs(request, env, url)
    return env.ASSETS.fetch(request)
  },

  scheduled(controller, env, ctx) {
    const cutoff = Math.floor(controller.scheduledTime / 1_000) - 30 * 86_400
    ctx.waitUntil(
      (async () => {
        const result = await env.DB.prepare('DELETE FROM feedback WHERE created_at < ?1').bind(cutoff).run()
        if (!result.success) throw new Error('Feedback retention failed')
      })(),
    )
  },
}
