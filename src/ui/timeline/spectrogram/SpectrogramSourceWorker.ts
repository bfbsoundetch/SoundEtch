/// <reference lib="webworker" />

import { SOURCE_BUFFER_BYTES } from './SpectrogramTiling'
import type { SpectrogramSourceCommand, SpectrogramSourceMessage } from './SpectrogramSourceProtocol'

interface SourceRequestState {
  canceled: boolean
  continueResolver?: (buffer: ArrayBuffer | undefined) => void
}

interface PackedWindowRead {
  columnOffset: number
  windowStart: number
  readStart: number
  data: ArrayBuffer
}

const worker = self as unknown as DedicatedWorkerGlobalScope
const requests = new Map<number, SourceRequestState>()
const MAX_READS_IN_FLIGHT = 16

worker.onmessage = (event: MessageEvent<SpectrogramSourceCommand>) => {
  const command = event.data
  if (command.type === 'cancel') {
    const state = requests.get(command.requestId)
    if (state !== undefined) {
      state.canceled = true
      state.continueResolver?.(undefined)
    }
    return
  }

  if (command.type === 'continue') {
    const state = requests.get(command.requestId)
    state?.continueResolver?.(command.reusableBuffer)
    return
  }

  const previous = requests.get(command.requestId)
  if (previous !== undefined) {
    previous.canceled = true
    previous.continueResolver?.(undefined)
  }
  const state: SourceRequestState = { canceled: false }
  requests.set(command.requestId, state)
  void loadSource(command, state)
}

async function loadSource(
  command: Extract<SpectrogramSourceCommand, { type: 'load' }>,
  state: SourceRequestState,
): Promise<void> {
  try {
    if (
      command.sourceChannelCount < 1 ||
      command.hop < 1 ||
      command.fftSize < 1 ||
      command.columnCount < 1
    ) {
      throw new Error('Invalid spectrogram source request dimensions')
    }

    const bytesPerFrame = command.sourceChannelCount * Float32Array.BYTES_PER_ELEMENT
    const fileFrameCount = Math.floor(command.file.size / bytesPerFrame)
    const sourceFrameCount = Math.max(0, Math.min(fileFrameCount, Math.floor(command.clipLength)))
    const firstWindowStart = command.firstColumn * command.hop - command.fftSize / 2
    const finalWindowEnd =
      (command.firstColumn + command.columnCount - 1) * command.hop - command.fftSize / 2 + command.fftSize
    const requestedFrameCount = finalWindowEnd - firstWindowStart
    const interleavedByteLength = requestedFrameCount * bytesPerFrame

    if (interleavedByteLength <= SOURCE_BUFFER_BYTES) {
      await loadInterleaved(command, state, firstWindowStart, requestedFrameCount, sourceFrameCount, bytesPerFrame)
    } else {
      await loadPackedWindows(command, state, firstWindowStart, sourceFrameCount, bytesPerFrame)
    }

    if (!state.canceled) {
      const message: SpectrogramSourceMessage = { type: 'complete', requestId: command.requestId, sourceFrameCount }
      worker.postMessage(message)
    }
  } catch (error) {
    if (!state.canceled) {
      const message: SpectrogramSourceMessage = {
        type: 'error',
        requestId: command.requestId,
        message: error instanceof Error ? error.message : String(error),
      }
      worker.postMessage(message)
    }
  } finally {
    if (requests.get(command.requestId) === state) requests.delete(command.requestId)
  }
}

async function loadInterleaved(
  command: Extract<SpectrogramSourceCommand, { type: 'load' }>,
  state: SourceRequestState,
  firstWindowStart: number,
  requestedFrameCount: number,
  sourceFrameCount: number,
  bytesPerFrame: number,
): Promise<void> {
  const data = new ArrayBuffer(requestedFrameCount * bytesPerFrame)
  const readStart = Math.max(0, firstWindowStart)
  const readEnd = Math.min(sourceFrameCount, firstWindowStart + requestedFrameCount)

  if (readEnd > readStart) {
    const source = await command.file.slice(readStart * bytesPerFrame, readEnd * bytesPerFrame).arrayBuffer()
    if (state.canceled) return
    new Uint8Array(data).set(new Uint8Array(source), (readStart - firstWindowStart) * bytesPerFrame)
  }
  if (state.canceled) return

  const message: SpectrogramSourceMessage = {
    type: 'source-batch',
    requestId: command.requestId,
    layout: 'interleaved',
    data,
    firstFrame: firstWindowStart,
    firstChannel: 0,
    batchChannelCount: command.sourceChannelCount,
    sourceFrameCount,
  }
  worker.postMessage(message, [data])
}

async function loadPackedWindows(
  command: Extract<SpectrogramSourceCommand, { type: 'load' }>,
  state: SourceRequestState,
  firstWindowStart: number,
  sourceFrameCount: number,
  bytesPerFrame: number,
): Promise<void> {
  const floatsPerChannel = command.columnCount * command.fftSize
  const bytesPerChannel = floatsPerChannel * Float32Array.BYTES_PER_ELEMENT
  const channelsPerBatch = Math.max(1, Math.floor(SOURCE_BUFFER_BYTES / bytesPerChannel))
  let reusableBuffer: ArrayBuffer | undefined

  for (let firstChannel = 0; firstChannel < command.sourceChannelCount; firstChannel += channelsPerBatch) {
    if (state.canceled) return

    const batchChannelCount = Math.min(channelsPerBatch, command.sourceChannelCount - firstChannel)
    const requiredBytes = batchChannelCount * bytesPerChannel
    const data = reusableBuffer !== undefined && reusableBuffer.byteLength >= requiredBytes
      ? reusableBuffer
      : new ArrayBuffer(requiredBytes)
    const output = new Float32Array(data, 0, requiredBytes / Float32Array.BYTES_PER_ELEMENT)
    output.fill(0)

    for (let groupStart = 0; groupStart < command.columnCount; groupStart += MAX_READS_IN_FLIGHT) {
      if (state.canceled) return

      const reads = new Array<Promise<PackedWindowRead>>()
      const groupEnd = Math.min(command.columnCount, groupStart + MAX_READS_IN_FLIGHT)
      for (let columnOffset = groupStart; columnOffset < groupEnd; columnOffset++) {
        const windowStart = firstWindowStart + columnOffset * command.hop
        const readStart = Math.max(0, windowStart)
        const readEnd = Math.min(sourceFrameCount, windowStart + command.fftSize)
        if (readEnd <= readStart) continue

        reads.push(
          command.file.slice(readStart * bytesPerFrame, readEnd * bytesPerFrame).arrayBuffer().then((data) => ({
            columnOffset,
            windowStart,
            readStart,
            data,
          })),
        )
      }

      const completedReads = await Promise.all(reads)
      if (state.canceled) return
      for (const read of completedReads) {
        const source = new Float32Array(read.data)
        const validFrameCount = source.length / command.sourceChannelCount
        const windowDestinationOffset = read.readStart - read.windowStart
        for (let channelOffset = 0; channelOffset < batchChannelCount; channelOffset++) {
          const sourceChannel = firstChannel + channelOffset
          const destinationStart =
            (channelOffset * command.columnCount + read.columnOffset) * command.fftSize + windowDestinationOffset
          for (let frame = 0; frame < validFrameCount; frame++) {
            output[destinationStart + frame] = source[frame * command.sourceChannelCount + sourceChannel]
          }
        }
      }
    }

    const message: SpectrogramSourceMessage = {
      type: 'source-batch',
      requestId: command.requestId,
      layout: 'packed-windows',
      data,
      firstFrame: firstWindowStart,
      firstChannel,
      batchChannelCount,
      sourceFrameCount,
    }
    worker.postMessage(message, [data])

    if (firstChannel + batchChannelCount < command.sourceChannelCount) {
      reusableBuffer = await new Promise<ArrayBuffer | undefined>((resolve) => {
        state.continueResolver = resolve
      })
      state.continueResolver = undefined
    }
  }
}
