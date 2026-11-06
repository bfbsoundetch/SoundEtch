import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import { AudioFileWriter } from './AudioFileWriter'
import { RingBuffer } from 'ringbuf.js'
import { FileSystemSyncAccessHandle } from '../filesystem/FileSystemSyncAccessHandle'
import { GlobalSettings } from '../global/GlobalSettings'
import { Summary } from '../project/Summary'
import { MemoryBackedFileSystemSyncAccessHandle } from '../filesystem/MemoryBackedFileSystemSyncAccessHandle'

GlobalSettings.useMemoryFS = true

test('write test', async () => {
  const file = await FileSystemUtils.getFileHandle('test', 'test')
  const syncFileAccessHandle: FileSystemSyncAccessHandle = await file.createSyncAccessHandle()
  const ringBufferArray = RingBuffer.getStorageForCapacity(1024, Float32Array)
  const ringBuffer = new RingBuffer(ringBufferArray, Float32Array)
  const inputBuffer = getInputArrayBuffer(1.1, 2.2, 3.3, 4.4, 5.5)
  ringBuffer.push(new Float32Array(inputBuffer))
  const audioFileWriter = new AudioFileWriter(
    syncFileAccessHandle,
    new Summary(1),
    ringBufferArray,
    new SharedArrayBuffer(4),
    1,
  )

  await audioFileWriter.maybeGetChunkAndWrite()

  const outputBuffer = new ArrayBuffer(20)
  syncFileAccessHandle.read(outputBuffer)
  expect(ringBuffer.availableRead()).toBe(0)
  expect(new Uint8Array(outputBuffer)).toEqual(new Uint8Array(inputBuffer))
})

function getInputArrayBuffer(...data: Array<number>): ArrayBuffer {
  const result = new Float32Array(new ArrayBuffer(Float32Array.BYTES_PER_ELEMENT * data.length))
  for (let i = 0; i < data.length; ++i) {
    result[i] = data[i]
  }
  return result.buffer
}

test('quota write failure retains the saved prefix and closes both handles despite cleanup errors', async () => {
  const recording = createRecording(new Float32Array([0.25, -0.5]))
  await recording.writer.maybeGetChunkAndWrite()
  recording.ringBuffer.push(new Float32Array([0.75]))
  const quota = new DOMException('Storage is full', 'QuotaExceededError')
  vi.spyOn(recording.audio, 'write').mockImplementation(() => {
    throw quota
  })
  recording.closeAudio.mockImplementation(() => {
    recording.audioClose()
    throw new Error('Audio close failed')
  })
  recording.closeSummary.mockImplementation(() => {
    recording.summaryClose()
    throw new Error('Summary close failed')
  })
  const onError = vi.fn()

  await expect(recording.writer.runFileWritingLoop(onError)).rejects.toBe(quota)

  expect(await recordedSamples(recording.audio)).toEqual(new Float32Array([0.25, -0.5]))
  expect(recording.summary.length).toBe(2)
  expect(onError).toHaveBeenCalledExactlyOnceWith(quota)
  expect(recording.closeAudio).toHaveBeenCalledOnce()
  expect(recording.closeSummary).toHaveBeenCalledOnce()
})

test.each(['audio', 'summary'] as const)('quota %s flush failure retains written audio and closes both handles', async (file) => {
  const samples = new Float32Array([0.25, -0.5])
  const recording = createRecording(samples)
  const quota = new DOMException('Flush exceeded quota', 'QuotaExceededError')
  vi.spyOn(file === 'audio' ? recording.audio : recording.summaryFile, 'flush').mockImplementation(() => {
    throw quota
  })
  const onError = vi.fn()

  await expect(recording.writer.runFileWritingLoop(onError)).rejects.toBe(quota)

  expect(await recordedSamples(recording.audio)).toEqual(samples)
  expect(recording.summary.length).toBe(2)
  expect(onError).toHaveBeenCalledExactlyOnceWith(quota)
  expect(recording.closeAudio).toHaveBeenCalledOnce()
  expect(recording.closeSummary).toHaveBeenCalledOnce()
})

test('quota while writing a full summary bucket preserves PCM and regenerates the missing saved summary', async () => {
  const samples = new Float32Array(600).fill(-0.5)
  const recording = createRecording(samples)
  const quota = new DOMException('Summary storage is full', 'QuotaExceededError')
  vi.spyOn(recording.summaryFile, 'write').mockImplementation(() => {
    throw quota
  })
  const onError = vi.fn()

  await expect(recording.writer.runFileWritingLoop(onError)).rejects.toBe(quota)

  expect(await recordedSamples(recording.audio)).toEqual(samples)
  expect(recording.summary.length).toBe(600)
  expect(onError).toHaveBeenCalledExactlyOnceWith(quota)
  expect(recording.closeAudio).toHaveBeenCalledOnce()
  expect(recording.closeSummary).toHaveBeenCalledOnce()
  const restored = new Summary(1)
  await restored.populateFromFile(await recording.summaryFile.getFile(), await recording.audio.getFile(), 1)
  expect(restored.length).toBe(600)
  expect(restored.getMeanSquaredPeak(512, 600)).toBeCloseTo(0.25, 4)
})

test('quota during final summary write releases both handles and keeps saved audio recoverable', async () => {
  const samples = new Float32Array([0.25, -0.5])
  const recording = createRecording(samples)
  const quota = new DOMException('Summary exceeded quota', 'QuotaExceededError')
  vi.spyOn(recording.summaryFile, 'write').mockImplementation(() => {
    throw quota
  })
  recording.writer.stop()
  const onError = vi.fn()

  await expect(recording.writer.runFileWritingLoop(onError)).rejects.toBe(quota)

  expect(await recordedSamples(recording.audio)).toEqual(samples)
  expect(onError).toHaveBeenCalledExactlyOnceWith(quota)
  expect(recording.closeAudio).toHaveBeenCalledOnce()
  expect(recording.closeSummary).toHaveBeenCalledOnce()
  const restored = new Summary(1)
  await restored.populateFromFile(await recording.summaryFile.getFile(), await recording.audio.getFile(), 1)
  expect(restored.length).toBe(2)
  expect(restored.getSummaryOfRange(0, 2, 256)[0]).toEqual([
    expect.closeTo(0.25, 4),
    expect.closeTo(-0.5, 4),
  ])
})

test('short byte writes preserve all audio samples and their summary length', async () => {
  const samples = new Float32Array([0.25, -0.5, 0.75])
  const recording = createRecording(samples)
  const access: FileSystemSyncAccessHandle = recording.audio
  const write = access.write.bind(access)
  vi.spyOn(recording.audio, 'write').mockImplementation((buffer, options) =>
    write(bufferBytes(buffer).subarray(0, 3), options),
  )
  recording.writer.stop()

  await recording.writer.runFileWritingLoop()

  expect(await recordedSamples(recording.audio)).toEqual(samples)
  expect(recording.summary.length).toBe(3)
  expect(recording.closeAudio).toHaveBeenCalledOnce()
  expect(recording.closeSummary).toHaveBeenCalledOnce()
})

test('quota after a partial stereo write retains only complete interleaved frames', async () => {
  const samples = new Float32Array([0.25, -0.5, 0.75, -1])
  const recording = createRecording(samples, 2)
  const quota = new DOMException('No more storage', 'QuotaExceededError')
  const access: FileSystemSyncAccessHandle = recording.audio
  const write = access.write.bind(access)
  vi.spyOn(recording.audio, 'write')
    .mockImplementationOnce((buffer, options) => write(bufferBytes(buffer).subarray(0, 11), options))
    .mockImplementation(() => {
      throw quota
    })

  await expect(recording.writer.runFileWritingLoop()).rejects.toBe(quota)

  expect(await recordedSamples(recording.audio)).toEqual(samples.subarray(0, 2))
  expect(recording.summary.length).toBe(1)
  expect(recording.summary.getSummaryOfRange(0, 1, 256)).toEqual([
    [expect.closeTo(0.25, 4), expect.closeTo(0.25, 4)],
    [expect.closeTo(-0.5, 4), expect.closeTo(-0.5, 4)],
  ])
  expect(recording.closeAudio).toHaveBeenCalledOnce()
  expect(recording.closeSummary).toHaveBeenCalledOnce()
})

test('a zero-byte write fails instead of looping or advertising unwritten audio', async () => {
  const recording = createRecording(new Float32Array([0.25]))
  vi.spyOn(recording.audio, 'write').mockReturnValue(0)

  await expect(recording.writer.runFileWritingLoop()).rejects.toThrow()

  expect(recording.audio.getSize()).toBe(0)
  expect(recording.summary.length).toBe(0)
  expect(recording.closeAudio).toHaveBeenCalledOnce()
  expect(recording.closeSummary).toHaveBeenCalledOnce()
})

function createRecording(samples: Float32Array, channelCount = 1) {
  const audio = new MemoryBackedFileSystemSyncAccessHandle('audio')
  const summaryFile = new MemoryBackedFileSystemSyncAccessHandle('summary')
  const audioClose = audio.close.bind(audio)
  const summaryClose = summaryFile.close.bind(summaryFile)
  const closeAudio = vi.spyOn(audio, 'close')
  const closeSummary = vi.spyOn(summaryFile, 'close')
  const summary = new Summary(channelCount)
  summary.setSyncFileHandle(summaryFile)
  const ringBufferArray = RingBuffer.getStorageForCapacity(1024, Float32Array)
  const ringBuffer = new RingBuffer(ringBufferArray, Float32Array)
  ringBuffer.push(samples)
  const writer = new AudioFileWriter(audio, summary, ringBufferArray, new SharedArrayBuffer(4), channelCount)
  return { audio, summaryFile, audioClose, summaryClose, closeAudio, closeSummary, summary, ringBuffer, writer }
}

function bufferBytes(buffer: BufferSource): Uint8Array {
  return ArrayBuffer.isView(buffer)
    ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    : new Uint8Array(buffer)
}

async function recordedSamples(handle: MemoryBackedFileSystemSyncAccessHandle): Promise<Float32Array> {
  return new Float32Array(await (await handle.getFile()).arrayBuffer())
}
