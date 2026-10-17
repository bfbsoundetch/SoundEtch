import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import type { FileSystemSyncAccessHandle } from '../filesystem/FileSystemSyncAccessHandle'
import { LoudnessNormalizer } from './LoudnessNormalizer'
import {
  LoudnessNormalizingStartMessage,
  RenderingConsumerPortMessage,
  RenderingEncodingPortMessage,
  RenderingOutputWorkerMessage,
} from './RenderingWorkerProtocol'

const CHUNK_FRAMES = 131072
// Reading from OPFS outpaces every encoder, so chunks are only posted while the consumer keeps up.
const MAX_IN_FLIGHT_CHUNKS = 4

// Pass 2 of loudness-normalized export: streams the pass-1 temp file through gain and the true-peak
// limiter, speaking the same port protocol as RenderingJob.
self.onmessage = async (event) => {
  const { dirname, filename, sampleRate, channelCount, length, gain, truePeakCeilingDb, encodingPort } =
    event.data as LoudnessNormalizingStartMessage

  try {
    let credits = MAX_IN_FLIGHT_CHUNKS
    let creditWaiter: (() => void) | null = null
    encodingPort.onmessage = (portEvent) => {
      if ((portEvent.data as RenderingConsumerPortMessage).type !== 'consumed') {
        return
      }
      ++credits
      creditWaiter?.()
      creditWaiter = null
    }

    const post = async (chunk: Float32Array<ArrayBuffer>) => {
      if (chunk.length === 0) {
        return
      }
      while (credits === 0) {
        const { promise, resolve } = Promise.withResolvers<void>()
        creditWaiter = resolve
        await promise
      }
      --credits
      encodingPort.postMessage(
        { type: 'audio', buffer: chunk.buffer, length: chunk.length } satisfies RenderingEncodingPortMessage,
        [chunk.buffer],
      )
    }

    const fileHandle = await FileSystemUtils.getFileHandle(dirname, filename)
    const file = await (
      fileHandle as FileSystemFileHandle & { createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle> }
    ).createSyncAccessHandle()
    const normalizer = new LoudnessNormalizer(sampleRate, channelCount, gain, truePeakCeilingDb)
    const view = new Float32Array(CHUNK_FRAMES * channelCount)
    let readFrames = 0
    let bytePosition = 0
    try {
      while (readFrames < length) {
        const frames = Math.min(CHUNK_FRAMES, length - readFrames)
        const bytesRead = file.read(view.subarray(0, frames * channelCount), { at: bytePosition })
        if (bytesRead === 0) {
          break
        }
        bytePosition += bytesRead
        readFrames += bytesRead / (Float32Array.BYTES_PER_ELEMENT * channelCount)
        await post(normalizer.process(view.subarray(0, bytesRead / Float32Array.BYTES_PER_ELEMENT)))
      }
    } finally {
      file.close()
    }

    await post(normalizer.finish())
    encodingPort.postMessage({ type: 'stop' } satisfies RenderingEncodingPortMessage)
  } catch (error) {
    console.error(error)
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    } satisfies RenderingOutputWorkerMessage)
  }
}
