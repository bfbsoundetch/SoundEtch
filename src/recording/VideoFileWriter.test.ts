import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { VideoFileWriter } from './VideoFileWriter'
import type { VideoFileWritingResponse } from './VideoFileWritingWorker'

class RecordingWorker extends EventTarget {
  static latest: RecordingWorker
  postMessage = vi.fn()
  terminate = vi.fn()

  constructor() {
    super()
    RecordingWorker.latest = this
  }

  respond(data: VideoFileWritingResponse) {
    this.dispatchEvent(new MessageEvent('message', { data }))
  }
}

beforeEach(() => vi.stubGlobal('Worker', RecordingWorker))
afterEach(() => vi.unstubAllGlobals())

test('concurrent close calls both wait for handle release and block later muxer writes', async () => {
  const opening = VideoFileWriter.open('project', 'clip_video_0')
  const worker = RecordingWorker.latest
  worker.respond({ type: 'done', size: 0 })
  const writer = await opening
  const closing = writer.close()
  expect(writer.close()).toBe(closing)
  expect(worker.terminate).not.toHaveBeenCalled()
  await expect(writer.write(new Uint8Array(4), 0)).rejects.toThrow()
  expect(worker.postMessage).toHaveBeenCalledTimes(2)
  worker.respond({ type: 'done', size: 0 })
  await closing
  expect(worker.terminate).toHaveBeenCalledOnce()
})

test('failed-open cleanup closes an acquired handle before surfacing the original quota error', async () => {
  const opening = VideoFileWriter.open('project', 'clip_video_0')
  const result = expect(opening).rejects.toMatchObject({ name: 'QuotaExceededError', message: 'Truncation failed' })
  const worker = RecordingWorker.latest
  worker.respond({ type: 'error', name: 'QuotaExceededError', message: 'Truncation failed' })
  await Promise.resolve()
  expect(worker.postMessage).toHaveBeenLastCalledWith({ type: 'close' })
  expect(worker.terminate).not.toHaveBeenCalled()
  worker.respond({ type: 'error', name: 'QuotaExceededError', message: 'Flush failed' })
  await result
  expect(worker.terminate).toHaveBeenCalledOnce()
})
