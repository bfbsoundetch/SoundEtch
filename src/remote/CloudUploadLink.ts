import type { UploadLink } from '../backup/CloudStorage'
import { retryAfterHeaderSeconds, waitBeforeRetry } from '../backup/CloudStorage'

const SERVICE = 'The cloud storage'
const LOOPBACK_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '[::1]']

/** The link can take no (more) uploads: consumed or conflicting (Dropbox), or expired or refused (S3). */
export class UploadLinkUnusableError extends Error {
  override name = 'UploadLinkUnusableError'

  constructor(readonly status: number) {
    super(`The upload link was refused (HTTP ${status}).`)
  }
}

/**
 * Uploads `bytes` through `link` and returns the content hash Dropbox reports for a `POST` link, or null for a `PUT`
 * link, whose service reports none. Retries network failures, 429 and 5xx.
 */
export async function uploadToLink(
  link: UploadLink,
  bytes: Uint8Array<ArrayBuffer>,
  signal?: AbortSignal,
): Promise<string | null> {
  for (let attempt = 1; ; ++attempt) {
    signal?.throwIfAborted()
    let response: Response
    try {
      response = await fetch(link.url, {
        method: link.method,
        body: bytes,
        headers: { 'Content-Type': 'application/octet-stream' },
        credentials: 'omit',
        signal,
      })
    } catch (error) {
      // Network and CORS failures are TypeErrors; an abort is a DOMException and ends the upload.
      if (!(error instanceof TypeError)) {
        throw error
      }
      await waitBeforeRetry(SERVICE, attempt, null, signal)
      continue
    }
    if (response.ok) {
      if (link.method == 'PUT') {
        await response.body?.cancel()
        return null
      }
      const result: unknown = await response.json()
      const contentHash =
        typeof result == 'object' && result ? (result as Record<string, unknown>)['content-hash'] : null
      return typeof contentHash == 'string' ? contentHash : null
    }
    await response.body?.cancel()
    if (response.status == 403 || response.status == 409 || response.status == 410) {
      throw new UploadLinkUnusableError(response.status)
    }
    if (response.status == 429 || response.status >= 500) {
      await waitBeforeRetry(SERVICE, attempt, retryAfterHeaderSeconds(response), signal)
      continue
    }
    throw new Error(`${SERVICE} rejected the upload (HTTP ${response.status}).`)
  }
}

/**
 * Whether a guest may upload to `url`: HTTPS (or HTTP on a loopback host, for local services) at `sessionOrigin`, the
 * origin of the session's first link, so a recorder cannot spread one session's media over several services.
 */
export function isAllowedUploadUrl(url: string, sessionOrigin: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  const secure = parsed.protocol == 'https:' || (parsed.protocol == 'http:' && LOOPBACK_HOSTS.includes(parsed.hostname))
  return secure && parsed.origin == sessionOrigin
}
