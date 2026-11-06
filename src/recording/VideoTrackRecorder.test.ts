import {
  BufferTarget,
  EncodedPacket,
  EncodedVideoPacketSource,
  Mp4OutputFormat,
  Output,
} from 'mediabunny'
import { beforeEach, expect, test, vi } from 'vitest'
import { VideoTrackRecorder } from './VideoTrackRecorder'

const storage = vi.hoisted(() => ({
  trim: vi.fn<() => Promise<number>>(),
  read: vi.fn<() => Promise<Blob>>(),
  delete: vi.fn<() => Promise<void>>(),
}))

vi.mock('./VideoFileWriter', () => ({ VideoFileWriter: { trimInterruptedFile: storage.trim } }))
vi.mock('../filesystem/FileSystemUtils', () => ({
  FileSystemUtils: { getExistingFile: storage.read, deleteFile: storage.delete },
}))

const target = new BufferTarget()
const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'fragmented' }), target })
const source = new EncodedVideoPacketSource('vp9')
output.addVideoTrack(source)
await output.start()
for (let i = 0; i < 60; i++) {
  await source.add(
    new EncodedPacket(new Uint8Array(500), i == 0 ? 'key' : 'delta', i / 30, 1 / 30),
    i == 0 ? { decoderConfig: { codec: 'vp09.00.10.08', codedWidth: 64, codedHeight: 48 } } : undefined,
  )
}
await output.finalize()
const footage = new Blob([target.buffer!])

beforeEach(() => {
  vi.resetAllMocks()
  storage.trim.mockResolvedValue(footage.size)
  storage.read.mockResolvedValue(footage)
  storage.delete.mockResolvedValue()
})

function createRecorder() {
  const onError = vi.fn()
  const recorder = new VideoTrackRecorder({
    directory: 'project',
    filename: 'clip_video_0',
    sampleRate: 48000,
    timeline: () => ({ seconds: 2, running: true }),
    minimumHeight: 0,
    onProgress: vi.fn(),
    onError,
  })
  const close = vi.fn<() => Promise<void>>().mockResolvedValue()
  const cancel = vi.fn<() => Promise<void>>().mockResolvedValue()
  const finalize = vi.fn<() => Promise<void>>().mockResolvedValue()
  // Isolate the failure/finish lifecycle from browser frame capture and hardware encoding.
  const state = recorder as unknown as {
    queue: Promise<void>
    fail(error: unknown): void
  }
  Object.assign(recorder, { writer: { close }, output: { cancel, finalize } })
  return { recorder, state, close, cancel, finalize, onError }
}

const quota = () => new DOMException('Storage is full', 'QuotaExceededError')

test('an in-flight quota failure notifies immediately and concurrent finish calls recover the same prefix', async () => {
  const { recorder, state, close, cancel, finalize, onError } = createRecorder()
  const order: string[] = []
  close.mockImplementation(async () => {
    order.push('close')
  })
  cancel.mockImplementation(async () => {
    order.push('cancel')
  })
  storage.trim.mockImplementation(async () => {
    order.push('trim')
    return footage.size
  })
  let finish: Promise<unknown> | undefined
  onError.mockImplementation(() => {
    finish = recorder.finish()
  })
  state.queue = Promise.resolve().then(() => {
    state.fail(quota())
    expect(onError).toHaveBeenCalledOnce()
    state.fail(quota())
  })
  await state.queue
  expect(recorder.finish()).toBe(finish)
  expect(await finish).toMatchObject({ startSample: 0, length: 96000, mimeType: 'video/mp4' })
  expect(order).toEqual(['close', 'cancel', 'trim'])
  expect(onError).toHaveBeenCalledOnce()
  expect(finalize).not.toHaveBeenCalled()
  expect(storage.delete).not.toHaveBeenCalled()
})

test('quota during finalization still notifies and recovers when recording has already stopped', async () => {
  const { recorder, finalize, onError } = createRecorder()
  finalize.mockRejectedValue(quota())
  expect(await recorder.finish()).toMatchObject({ length: 96000 })
  expect(onError).toHaveBeenCalledOnce()
  expect(storage.delete).not.toHaveBeenCalled()
})

test('quota before any complete fragment returns no fake footage', async () => {
  const { recorder, state } = createRecorder()
  storage.trim.mockResolvedValue(0)
  state.fail(quota())
  expect(await recorder.finish()).toBeNull()
  expect(storage.read).not.toHaveBeenCalled()
  expect(storage.delete).toHaveBeenCalledWith('project', 'clip_video_0')
})

test('failed writer flush and muxer cancellation cannot prevent prefix recovery', async () => {
  const { recorder, state, close, cancel } = createRecorder()
  close.mockRejectedValue(quota())
  cancel.mockRejectedValue(new Error('The output is already finalizing'))
  state.fail(quota())
  expect(await recorder.finish()).toMatchObject({ length: 96000 })
  expect(storage.delete).not.toHaveBeenCalled()
})

test.each(['trim', 'read'] as const)('a %s recovery failure leaves the recording file untouched for reload', async (step) => {
  const { recorder, state } = createRecorder()
  storage[step].mockRejectedValue(new Error('Recovery unavailable'))
  state.fail(quota())
  await expect(recorder.finish()).rejects.toThrow('Recovery unavailable')
  expect(storage.delete).not.toHaveBeenCalled()
})
