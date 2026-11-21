import { afterEach, expect, test, vi } from 'vitest'
import { isAllowedUploadUrl, uploadToLink } from './CloudUploadLink'

afterEach(() => {
  vi.unstubAllGlobals()
})

test('network failures, 429 and 5xx are retried', async () => {
  const answers: Array<() => Response> = [
    () => {
      throw new TypeError('network')
    },
    () => new Response('slow down', { status: 429, headers: { 'Retry-After': '0' } }),
    () => new Response('oops', { status: 503, headers: { 'Retry-After': '0' } }),
    () => Response.json({ 'content-hash': 'abc' }),
  ]
  const fetch = vi.fn(async () => answers.shift()!())
  vi.stubGlobal('fetch', fetch)
  vi.useFakeTimers()
  try {
    const upload = uploadToLink({ method: 'POST', url: 'https://up.test/x', singleUse: true }, new Uint8Array(4))
    await vi.runAllTimersAsync()
    expect(await upload).toBe('abc')
  } finally {
    vi.useRealTimers()
  }
  expect(fetch).toHaveBeenCalledTimes(4)
  expect(fetch).toHaveBeenLastCalledWith('https://up.test/x', expect.objectContaining({ credentials: 'omit' }))
})

test('only HTTPS, or HTTP on loopback, at the session origin is allowed', () => {
  expect(isAllowedUploadUrl('https://content.dropboxapi.com/apitul/1/a', 'https://content.dropboxapi.com')).toBe(true)
  expect(isAllowedUploadUrl('https://evil.test/a', 'https://content.dropboxapi.com')).toBe(false)
  expect(isAllowedUploadUrl('http://s3.test/a', 'http://s3.test')).toBe(false)
  expect(isAllowedUploadUrl('http://localhost:9000/b/k', 'http://localhost:9000')).toBe(true)
  expect(isAllowedUploadUrl('http://127.0.0.1:9000/b/k', 'http://127.0.0.1:9000')).toBe(true)
  expect(isAllowedUploadUrl('not a url', 'https://a.test')).toBe(false)
})
