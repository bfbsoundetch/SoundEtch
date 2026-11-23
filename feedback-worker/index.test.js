import { createHmac } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { createTestHarness } from 'wrangler'

const ORIGIN = 'https://feedback.example.test'
const IP = '192.0.2.17'
const HASH_SECRET = 'a4'.repeat(32)
const SITE_SECRET = 'synthetic-siteverify-secret'
const workerOptions = {
  configPath: './feedback-worker/wrangler.jsonc',
  vars: { TURNSTILE_SITE_KEY: 'synthetic-public-sitekey', TURNSTILE_ACTION: 'feedback' },
  secrets: { TURNSTILE_SECRET_KEY: SITE_SECRET, IP_HASH_SECRET: HASH_SECRET },
}
const server = createTestHarness({ workers: [workerOptions] })
let worker
let db
let outbound
let verification

function ipHash(ip = IP, secret = HASH_SECRET) {
  return createHmac('sha256', secret).update(ip).digest('hex')
}

function post(payload = { message: 'Playback stopped.', turnstileToken: 'valid-token' }, options = {}) {
  const headers = new Headers({
    Origin: ORIGIN,
    'Content-Type': 'application/json',
    'CF-Connecting-IP': IP,
    ...options.headers,
  })
  for (const key of options.omitHeaders ?? []) headers.delete(key)
  return worker.fetch(`${ORIGIN}/api/feedback`, {
    method: 'POST',
    headers,
    body: options.body ?? JSON.stringify(payload),
    ...(options.duplex ? { duplex: options.duplex } : {}),
  })
}

async function rows() {
  return (await db.prepare('SELECT * FROM feedback ORDER BY created_at, id').all()).results
}

async function expectError(response, status, code) {
  expect(response.status).toBe(status)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
  expect(await response.json()).toEqual({ error: code })
}

async function seed(entries) {
  await db.batch(
    entries.map(({ id = crypto.randomUUID(), time, hash = 'seed', message = 'seed', logs = '' }) =>
      db
        .prepare('INSERT INTO feedback (id, created_at, ip_hash, message, logs) VALUES (?, ?, ?, ?, ?)')
        .bind(id, time, hash, message, logs),
    ),
  )
}

async function updateOptions(overrides) {
  await server.update({
    workers: [
      {
        ...workerOptions,
        vars: { ...workerOptions.vars, ...overrides.vars },
        secrets: { ...workerOptions.secrets, ...overrides.secrets },
      },
    ],
  })
  worker = server.getWorker('soundetch-feedback')
  await worker.applyD1Migrations('DB')
  db = (await worker.getEnv()).DB
}

describe.sequential('private feedback Worker with real local D1', () => {
  beforeAll(async () => {
    await server.listen()
  }, 120_000)

  beforeEach(async () => {
    worker = server.getWorker('soundetch-feedback')
    await worker.applyD1Migrations('DB')
    db = (await worker.getEnv()).DB
    verification = async () =>
      Response.json({
        success: true,
        hostname: new URL(ORIGIN).hostname,
        action: 'feedback',
      })
    outbound = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input, init)
      if (request.url !== 'https://challenges.cloudflare.com/turnstile/v0/siteverify') {
        throw new Error(`Unexpected outbound destination: ${request.url}`)
      }
      const fields = new URLSearchParams(await request.text())
      return verification(fields.get('response'), request)
    })
  }, 60_000)

  afterEach(async () => {
    vi.restoreAllMocks()
    await server.reset()
  }, 120_000)

  afterAll(async () => {
    await server.close()
  }, 60_000)

  test('publishes only public configuration and serves standalone assets', async () => {
    const response = await worker.fetch(`${ORIGIN}/api/config`)
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({ siteKey: 'synthetic-public-sitekey', action: 'feedback' })
    const page = await server.fetch(`${ORIGIN}/`)
    expect(page.status).toBe(200)
    expect(page.headers.get('Content-Type')).toContain('text/html')
    expect(page.headers.get('Cross-Origin-Opener-Policy')).toBeNull()
    expect(page.headers.get('Cross-Origin-Embedder-Policy')).toBeNull()
    expect(outbound).not.toHaveBeenCalled()
  })

  function postPage(body, contentType = 'application/x-www-form-urlencoded') {
    return server.fetch(`${ORIGIN}/`, {
      method: 'POST',
      headers: { Origin: 'https://editor.example.test', 'Content-Type': contentType },
      body,
    })
  }

  function prefilledLogs(html) {
    const content = html.match(/<textarea[^>]*\bid="logs-preview"[^>]*>([^<]*)<\/textarea>/)[1]
    // HTML parsing drops one newline right after <textarea> and decodes character references.
    return content
      .replace(/^\n/, '')
      .replace(/&(lt|gt|amp|quot);/g, (_, name) => ({ lt: '<', gt: '>', amp: '&', quot: '"' })[name])
  }

  test('prefills cross-site posted logs as page text without storing them', async () => {
    const logs = '\nfirst\r\n</textarea><script>alert(1)</script> &amp; ✓\rlast'
    const response = await postPage(new URLSearchParams({ logs }))
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('text/html')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const html = await response.text()
    expect(html).not.toContain('<script>alert')
    expect(prefilledLogs(html)).toBe('\nfirst\n</textarea><script>alert(1)</script> &amp; ✓\nlast')
    expect(prefilledLogs(await (await postPage(new URLSearchParams({ logs: '' }))).text())).toBe('')
    expect(await rows()).toEqual([])
    expect(outbound).not.toHaveBeenCalled()
  })

  test('measures prefilled logs after line-break normalization and rejects other bodies', async () => {
    // Browsers submit form line breaks as CRLF; the page's textarea counts them as LF.
    const crlf = await postPage(new URLSearchParams({ logs: '\r\n'.repeat(65_536) }))
    expect(crlf.status).toBe(200)
    expect(prefilledLogs(await crlf.text())).toBe('\n'.repeat(65_536))
    await expectError(await postPage(new URLSearchParams({ logs: 'a'.repeat(65_537) })), 413, 'payload_too_large')
    await expectError(
      await postPage(JSON.stringify({ logs: 'text' }), 'application/json'),
      415,
      'unsupported_media_type',
    )
    expect(await rows()).toEqual([])
  })

  test('stores only accepted trimmed message and reviewed plain-text logs', async () => {
    const logs = '<script>not executed</script>\r\nprivate log\n\u0000✓'
    const start = Math.floor(Date.now() / 1_000)
    const response = await post({
      message: '  Playback stopped.\n ',
      logs,
      turnstileToken: 'valid-token',
      filename: 'not-stored.txt',
      email: 'not-stored@example.test',
      ip: 'attacker-supplied',
    })
    expect(response.status).toBe(201)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({ ok: true })
    const stored = await rows()
    expect(stored).toHaveLength(1)
    expect(stored[0]).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      created_at: expect.any(Number),
      ip_hash: ipHash(),
      message: 'Playback stopped.',
      logs,
    })
    expect(stored[0].created_at).toBeGreaterThanOrEqual(start)
    expect(stored[0].created_at).toBeLessThanOrEqual(Math.floor(Date.now() / 1_000))
    expect(JSON.stringify(stored)).not.toContain(IP)
    expect(JSON.stringify(stored)).not.toContain(SITE_SECRET)
    expect(JSON.stringify(stored)).not.toContain(HASH_SECRET)
  })

  test('defaults absent logs to empty and hashes the same trusted IP consistently', async () => {
    expect((await post()).status).toBe(201)
    expect((await post(undefined, { headers: { 'X-Forwarded-For': '203.0.113.99' } })).status).toBe(201)
    expect((await rows()).map((row) => [row.logs, row.ip_hash])).toEqual([
      ['', ipHash()],
      ['', ipHash()],
    ])
  })

  test('the IP hash depends on the server key', async () => {
    const otherSecret = 'b7'.repeat(32)
    await updateOptions({ secrets: { IP_HASH_SECRET: otherSecret } })
    expect((await post()).status).toBe(201)
    expect((await rows())[0].ip_hash).toBe(ipHash(IP, otherSecret))
    expect((await rows())[0].ip_hash).not.toBe(ipHash())
  }, 60_000)

  test('requires the exact same Origin before reading or verifying content', async () => {
    for (const origin of [null, 'https://foreign.example', `${ORIGIN}/`, 'null', 'http://feedback.example.test']) {
      await expectError(
        await post(undefined, origin === null ? { omitHeaders: ['Origin'] } : { headers: { Origin: origin } }),
        403,
        'invalid_origin',
      )
    }
    expect(await rows()).toEqual([])
    expect(outbound).not.toHaveBeenCalled()
  })

  test('rejects wrong media types but accepts a JSON charset parameter', async () => {
    for (const type of ['text/plain', 'multipart/form-data; boundary=x', 'application/jsonp']) {
      await expectError(await post(undefined, { headers: { 'Content-Type': type } }), 415, 'unsupported_media_type')
    }
    await expectError(await post(undefined, { omitHeaders: ['Content-Type'] }), 415, 'unsupported_media_type')
    expect(outbound).not.toHaveBeenCalled()
    expect((await post(undefined, { headers: { 'Content-Type': 'application/json; charset=utf-8' } })).status).toBe(201)
  })

  test('rejects malformed JSON, invalid UTF-8, and non-object top levels', async () => {
    for (const body of [
      '',
      '{',
      'null',
      '[]',
      'true',
      '"text"',
      new Uint8Array([0x7b, 0xff, 0x7d]),
      new Uint8Array([0x22, 0xe2, 0x82]),
    ]) {
      await expectError(await post(undefined, { body }), 400, 'invalid_request')
    }
    expect(await rows()).toEqual([])
    expect(outbound).not.toHaveBeenCalled()
  })

  test('rejects missing, wrongly typed, empty, or too-long fields', async () => {
    const valid = { message: 'text', turnstileToken: 'token' }
    const invalid = [
      {},
      { turnstileToken: 'token' },
      { message: 'text' },
      ...[null, 42, true, [], {}].map((message) => ({ ...valid, message })),
      ...[null, 42, true, [], {}].map((logs) => ({ ...valid, logs })),
      ...[null, 42, true, [], {}].map((turnstileToken) => ({ ...valid, turnstileToken })),
      { ...valid, message: ' \n\t ' },
      { ...valid, message: 'a'.repeat(4_001) },
      { ...valid, turnstileToken: '' },
      { ...valid, turnstileToken: 'a'.repeat(2_049) },
      { ...valid, message: '😀'.repeat(2_001) },
    ]
    for (const payload of invalid) await expectError(await post(payload), 400, 'invalid_request')
    expect(await rows()).toEqual([])
    expect(outbound).not.toHaveBeenCalled()
  })

  test('accepts exact message, UTF-8 log, and token limits including JSON escaping', async () => {
    const cases = [
      { message: '😀'.repeat(2_000), logs: '\u0000'.repeat(65_536), turnstileToken: 'x'.repeat(2_048) },
      { message: 'a'.repeat(4_000), logs: '\n'.repeat(65_536), turnstileToken: 'token' },
      { message: 'unicode logs', logs: '😀'.repeat(16_384), turnstileToken: 'token' },
    ]
    for (let i = 0; i < cases.length; i++) {
      expect((await post(cases[i], { headers: { 'CF-Connecting-IP': `192.0.2.${30 + i}` } })).status).toBe(201)
    }
    expect((await rows()).map((row) => [row.message, row.logs])).toEqual(
      expect.arrayContaining(cases.map(({ message, logs }) => [message, logs])),
    )
    expect(await rows()).toHaveLength(3)
  })

  test('rejects logs one byte beyond the decoded UTF-8 limit before verification', async () => {
    for (const logs of ['a'.repeat(65_537), `${'😀'.repeat(16_384)}a`]) {
      await expectError(await post({ message: 'text', logs, turnstileToken: 'token' }), 413, 'payload_too_large')
    }
    expect(await rows()).toEqual([])
    expect(outbound).not.toHaveBeenCalled()
  })

  test('enforces the exact wire boundary independently of decoded fields', async () => {
    const base = JSON.stringify({ message: 'text', turnstileToken: 'token', ignored: '' })
    const body = base.replace('"ignored":""', `"ignored":"${'x'.repeat(524_288 - base.length)}"`)
    expect(new TextEncoder().encode(body).byteLength).toBe(524_288)
    expect((await post(undefined, { body })).status).toBe(201)
    const oversized = `${body} `
    await expectError(
      await post(undefined, {
        body: oversized,
        headers: { 'Content-Length': String(oversized.length) },
      }),
      413,
      'payload_too_large',
    )
    expect(await rows()).toHaveLength(1)
    expect(outbound).toHaveBeenCalledTimes(1)
  })

  test('counts actual streaming bytes without Content-Length and rejects oversize', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"ignored":"'))
        for (let i = 0; i < 9; i++) controller.enqueue(new Uint8Array(65_536).fill(120))
        controller.close()
      },
    })
    await expectError(await post(undefined, { body: stream, duplex: 'half' }), 413, 'payload_too_large')
    expect(await rows()).toEqual([])
    expect(outbound).not.toHaveBeenCalled()
  })

  test('decodes UTF-8 split across streamed chunks without changing reviewed text', async () => {
    const payload = { message: 'streamed text', logs: '✓\r\n😀', turnstileToken: 'token' }
    const bytes = new TextEncoder().encode(JSON.stringify(payload))
    const stream = new ReadableStream({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]))
        controller.close()
      },
    })
    expect((await post(undefined, { body: stream, duplex: 'half' })).status).toBe(201)
    expect((await rows())[0].logs).toBe(payload.logs)
  })

  test.each([
    ['invalid', { success: false, 'error-codes': ['invalid-input-response'] }],
    ['wrong host', { success: true, hostname: 'foreign.example', action: 'feedback' }],
    ['wrong action', { success: true, hostname: new URL(ORIGIN).hostname, action: 'other' }],
    ['missing host', { success: true, action: 'feedback' }],
    ['missing action', { success: true, hostname: new URL(ORIGIN).hostname }],
  ])('fails closed for %s verification', async (_name, result) => {
    verification = async () => Response.json(result)
    await expectError(await post(), 403, 'verification_failed')
    expect(await rows()).toEqual([])
  })

  test('does not accept a consumed token twice', async () => {
    const consumed = new Set()
    verification = async (token) => {
      if (consumed.has(token)) return Response.json({ success: false, 'error-codes': ['timeout-or-duplicate'] })
      consumed.add(token)
      return Response.json({ success: true, hostname: new URL(ORIGIN).hostname, action: 'feedback' })
    }
    expect((await post()).status).toBe(201)
    await expectError(await post(), 403, 'verification_failed')
    expect(await rows()).toHaveLength(1)
  })

  test('treats upstream errors and malformed responses as unavailable without retry', async () => {
    const failures = [
      async () => {
        throw new Error('provider private exception')
      },
      async () => new Response('provider unavailable', { status: 503 }),
      async () => new Response('not JSON'),
      ...[null, [], {}, { success: 'true' }].map((body) => async () => Response.json(body)),
    ]
    for (const fail of failures) {
      verification = fail
      await expectError(await post(), 503, 'unavailable')
    }
    expect(outbound).toHaveBeenCalledTimes(failures.length)
    expect(await rows()).toEqual([])
  })

  test('times out a stalled Siteverify response after ten seconds without accepting', async () => {
    verification = () => new Promise(() => {})
    const start = performance.now()
    await expectError(await post(), 503, 'unavailable')
    expect(performance.now() - start).toBeGreaterThanOrEqual(9_500)
    expect(outbound).toHaveBeenCalledTimes(1)
    expect(await rows()).toEqual([])
  }, 25_000)

  test('fails closed when the trusted connecting IP is missing, even with forwarded IPs', async () => {
    // Miniflare supplies a loopback IP on incoming HTTP requests. Exercise the
    // actual handler directly for the missing-header boundary, with real D1.
    const { default: feedbackWorker } = await import('./src/index.js')
    const response = await feedbackWorker.fetch(
      new Request(`${ORIGIN}/api/feedback`, {
        method: 'POST',
        headers: {
          Origin: ORIGIN,
          'Content-Type': 'application/json',
          'X-Forwarded-For': IP,
          'X-Real-IP': IP,
        },
        body: JSON.stringify({ message: 'text', turnstileToken: 'token' }),
      }),
      await worker.getEnv(),
    )
    await expectError(response, 503, 'unavailable')
    expect(outbound).not.toHaveBeenCalled()
    expect(await rows()).toEqual([])
  })

  test.each(['TURNSTILE_SITE_KEY', 'TURNSTILE_ACTION', 'TURNSTILE_SECRET_KEY', 'IP_HASH_SECRET'])(
    'fails closed when %s is missing',
    async (key) => {
      await updateOptions(
        key === 'TURNSTILE_SITE_KEY' || key === 'TURNSTILE_ACTION'
          ? { vars: { [key]: '' } }
          : { secrets: { [key]: '' } },
      )
      await expectError(await worker.fetch(`${ORIGIN}/api/config`), 503, 'unavailable')
      await expectError(await post(), 503, 'unavailable')
      expect(await rows()).toEqual([])
      expect(outbound).not.toHaveBeenCalled()
    },
    60_000,
  )

  test('returns unavailable, never success, when the real database write fails', async () => {
    await db.prepare('DROP TABLE feedback').run()
    await expectError(await post(), 503, 'unavailable')
    expect(outbound).toHaveBeenCalledTimes(1)
  })

  test('atomically permits at most three reports per IP under concurrent requests', async () => {
    await seed([{ time: Math.floor(Date.now() / 1_000), hash: ipHash() }])
    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        post({ message: `concurrent ${index}`, turnstileToken: `token-${index}` }),
      ),
    )
    expect(responses.filter((response) => response.status === 201)).toHaveLength(2)
    for (const response of responses.filter((response) => response.status !== 201)) {
      await expectError(response, 429, 'rate_limited')
    }
    expect(await rows()).toHaveLength(3)
  }, 30_000)

  test('rolling-hour cutoff excludes older and exact-boundary rows, includes recent rows', async () => {
    const now = Math.floor(Date.now() / 1_000)
    await seed([
      ...Array.from({ length: 3 }, () => ({ time: now - 3_600, hash: ipHash() })),
      ...Array.from({ length: 2 }, () => ({ time: now - 3_540, hash: ipHash() })),
    ])
    // No clock override: timestamps at/before the cutoff stay outside as real time advances.
    expect((await post()).status).toBe(201)
    await expectError(await post(), 429, 'rate_limited')
    expect(await rows()).toHaveLength(6)
  })

  test('atomically permits at most 1000 reports per UTC day across distinct IPs', async () => {
    const now = Math.floor(Date.now() / 1_000)
    await seed(Array.from({ length: 998 }, (_, index) => ({ time: now, hash: `seed-${index}` })))
    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        post(
          { message: `daily ${index}`, turnstileToken: `token-${index}` },
          {
            headers: { 'CF-Connecting-IP': `198.51.100.${index + 1}` },
          },
        ),
      ),
    )
    expect(responses.filter((response) => response.status === 201)).toHaveLength(2)
    for (const response of responses.filter((response) => response.status !== 201)) {
      await expectError(response, 429, 'rate_limited')
    }
    expect(await rows()).toHaveLength(1000)
  }, 30_000)

  test('UTC-day accounting includes midnight but excludes previous day and next midnight', async () => {
    const dayStart = Math.floor(Date.now() / 86_400_000) * 86_400
    await seed([
      ...Array.from({ length: 999 }, (_, index) => ({ time: dayStart, hash: `today-${index}` })),
      { time: dayStart - 1, hash: 'yesterday' },
      { time: dayStart + 86_400, hash: 'tomorrow' },
    ])
    expect((await post()).status).toBe(201)
    await expectError(await post(undefined, { headers: { 'CF-Connecting-IP': '198.51.100.29' } }), 429, 'rate_limited')
    expect(await rows()).toHaveLength(1002)
  })

  test('has no public inbox or report-reading route and returns exact method headers', async () => {
    expect(
      (await post({ message: 'private-message-marker', logs: 'private-log-marker', turnstileToken: 'token' })).status,
    ).toBe(201)
    const id = (await rows())[0].id
    for (const path of ['/api/feedback', `/api/feedback?id=${id}`]) {
      const response = await worker.fetch(`${ORIGIN}${path}`)
      expect(response.headers.get('Allow')).toBe('POST')
      await expectError(response, 405, 'method_not_allowed')
    }
    const wrongConfigMethod = await worker.fetch(`${ORIGIN}/api/config`, { method: 'POST' })
    expect(wrongConfigMethod.headers.get('Allow')).toBe('GET')
    await expectError(wrongConfigMethod, 405, 'method_not_allowed')
    const preflight = await worker.fetch(`${ORIGIN}/api/feedback`, { method: 'OPTIONS' })
    expect(preflight.headers.get('Allow')).toBe('POST')
    await expectError(preflight, 405, 'method_not_allowed')
    for (const path of ['/api', '/api/reports', `/api/feedback/${id}`, '/api/unknown']) {
      await expectError(await worker.fetch(`${ORIGIN}${path}`), 404, 'not_found')
    }
    const absentAsset = await server.fetch(`${ORIGIN}/reports/${id}`)
    expect(absentAsset.status).toBe(404)
    expect(await absentAsset.text()).not.toContain('private-message-marker')
    expect(await rows()).toHaveLength(1)
  })

  test('scheduled handler deletes only rows strictly older than 30 days', async () => {
    const scheduledTime = new Date('2026-10-17T03:17:00.987Z')
    const cutoff = Math.floor(scheduledTime.getTime() / 1_000) - 30 * 86_400
    await seed([
      { id: 'expired', time: cutoff - 1 },
      { id: 'boundary', time: cutoff },
      { id: 'recent', time: cutoff + 1 },
    ])
    await worker.scheduled({ scheduledTime, cron: '17 3 * * *' })
    expect((await rows()).map((row) => row.id)).toEqual(['boundary', 'recent'])
  })
})
