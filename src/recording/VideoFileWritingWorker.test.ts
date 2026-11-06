import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import type { VideoFileWritingRequest, VideoFileWritingResponse } from './VideoFileWritingWorker'

const handle = vi.hoisted(() => ({
  truncate: vi.fn(),
  write: vi.fn<() => number>(),
  flush: vi.fn(),
  getSize: vi.fn(() => 64),
  close: vi.fn(),
}))

vi.mock('../filesystem/FileSystemUtils', () => ({
  FileSystemUtils: { getFileHandle: async () => ({ createSyncAccessHandle: async () => handle }) },
}))

const scope = { onmessage: null as ((event: MessageEvent<VideoFileWritingRequest>) => void) | null }
let respond: (response: VideoFileWritingResponse) => void

beforeAll(async () => {
  vi.stubGlobal('self', scope)
  vi.stubGlobal('postMessage', (response: VideoFileWritingResponse) => respond(response))
  // Exercise worker module initialization only after its worker-only globals exist.
  await import('./VideoFileWritingWorker')
})

afterAll(() => vi.unstubAllGlobals())

async function request(data: VideoFileWritingRequest): Promise<VideoFileWritingResponse> {
  const { promise, resolve } = Promise.withResolvers<VideoFileWritingResponse>()
  respond = resolve
  scope.onmessage!(new MessageEvent('message', { data }))
  return promise
}

beforeEach(async () => {
  vi.clearAllMocks()
  handle.write.mockReturnValue(4)
  handle.flush.mockReset()
  expect(await request({ type: 'open', directory: 'project', filename: 'clip_video_0' })).toEqual({
    type: 'done',
    size: 0,
  })
})

test('a short synchronous write is reported as quota exhaustion rather than a complete fragment', async () => {
  handle.write.mockReturnValue(2)
  expect(await request({ type: 'write', data: new Uint8Array(4), position: 64 })).toMatchObject({
    type: 'error',
    name: 'QuotaExceededError',
  })
  expect(await request({ type: 'close' })).toEqual({ type: 'done', size: 0 })
  expect(handle.close).toHaveBeenCalledOnce()
})

test('a quota error while flushing still releases the exclusive sync access handle', async () => {
  handle.flush.mockImplementation(() => {
    throw new DOMException('No space remains', 'QuotaExceededError')
  })
  expect(await request({ type: 'close' })).toMatchObject({ type: 'error', name: 'QuotaExceededError' })
  expect(handle.close).toHaveBeenCalledOnce()
})
