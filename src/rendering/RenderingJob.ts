import { ClipViewSubset } from '../playback/AudioFileReader'
import { RawDataAudioContext } from '@descript/web-audio-js'
import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import { FileSystemSyncAccessHandle } from '../filesystem/FileSystemSyncAccessHandle'
import { RenderingWorkerStartMessage, type RenderingConsumerPortMessage } from './RenderingWorkerProtocol'
import { connectRenderingMix } from './RenderingMix'

const BLOCK_SIZE = 1024
const RENDER_CHUNK_SAMPLE_CAPACITY = 1024 * 1024
// Consumers report progress per chunk. Slow effects such as noise reduction take seconds to fill a whole
// chunk, so a partial chunk is posted once this much time has passed since the last one.
const RENDER_CHUNK_MAX_INTERVAL_MS = 100

self.onmessage = async (e) => {
  const { argument, encodingPort, waitForConsumer = false } = e.data as RenderingWorkerStartMessage

  const length = argument.length

  const audioContext = new RawDataAudioContext({
    sampleRate: argument.sampleRate,
    blockSize: BLOCK_SIZE,
    numberOfChannels: argument.channelCount,
  })
  audioContext.resume()

  const mix = await connectRenderingMix(audioContext, argument)
  const processors = argument.trackSubsets.map(
    (track) =>
      new ReadingOfflineProcessor(
        argument.projectId,
        track.clipViews,
        track.channelCount,
        BLOCK_SIZE,
        argument.startPosition,
      ),
  )

  const output = new Array<Float32Array>(argument.channelCount)
  for (let i = 0; i < argument.channelCount; ++i) {
    output[i] = new Float32Array(BLOCK_SIZE)
  }

  const pendingChunk = new Float32Array(RENDER_CHUNK_SAMPLE_CAPACITY)
  let pendingLength = 0
  let lastFlushTime = performance.now()
  let acknowledge: (() => void) | null = null
  if (waitForConsumer) {
    encodingPort.onmessage = (event) => {
      if ((event.data as RenderingConsumerPortMessage).type !== 'consumed') return
      acknowledge?.()
      acknowledge = null
    }
  }

  const flushPendingChunk = async () => {
    if (pendingLength === 0) {
      return
    }

    const chunk = pendingChunk.slice(0, pendingLength)
    const consumed = waitForConsumer
      ? new Promise<void>((resolve) => {
          acknowledge = resolve
        })
      : null
    encodingPort.postMessage(
      {
        type: 'audio',
        buffer: chunk.buffer,
        length: pendingLength,
      },
      [chunk.buffer],
    )
    pendingLength = 0
    if (consumed) await consumed
    lastFlushTime = performance.now()
  }

  for (let i = 0; i < length; i += BLOCK_SIZE) {
    await Promise.all(processors.map((processor) => processor.maybeFillBuffer()))
    processors.forEach((processor, index) => processor.process(mix.sources[index].channelData))
    audioContext.process(output)

    const frameCount = Math.min(BLOCK_SIZE, length - i)
    const samplesToWrite = frameCount * argument.channelCount
    if (pendingLength + samplesToWrite > pendingChunk.length) {
      await flushPendingChunk()
    }

    for (let frame = 0; frame < frameCount; ++frame) {
      for (let channel = 0; channel < argument.channelCount; ++channel) {
        pendingChunk[pendingLength++] = output[channel][frame]
      }
    }

    if (performance.now() - lastFlushTime >= RENDER_CHUNK_MAX_INTERVAL_MS) {
      await flushPendingChunk()
    }
  }

  mix.disconnect()
  await flushPendingChunk()
  encodingPort.postMessage({ type: 'stop' })
}

class ReadingOfflineProcessor {
  private readingClipViewIndex = 0
  private writingClipViewIndex = 0
  private buffer = new Float32Array(1024 * 1024)
  private bufferReadPosition = 0
  private bufferWritePosition = 0
  private clipViewFile: FileSystemSyncAccessHandle | null = null
  private clipFileOffset = -1
  private writingClipInitialOffset = 0

  private writePosition
  private readPosition

  constructor(
    private readonly projectId: number,
    private readonly clipViews: Array<ClipViewSubset>,
    private readonly channelCount: number,
    private readonly blockSize: number,
    private readonly startPosition: number,
  ) {
    this.readPosition = this.writePosition = startPosition
    while (
      this.readingClipViewIndex < this.clipViews.length &&
      this.readPosition >=
        this.clipViews[this.readingClipViewIndex].startPosition + this.clipViews[this.readingClipViewIndex].length
    ) {
      ++this.readingClipViewIndex
    }
    this.writingClipViewIndex = this.readingClipViewIndex
  }

  process(outputBuffers: Array<Float32Array>) {
    let emitted = 0
    let clipView = this.clipViews[this.readingClipViewIndex]
    if (!clipView) {
      for (let channel = 0; channel < this.channelCount; ++channel) {
        outputBuffers[channel].fill(0)
      }
    }
    while (emitted < this.blockSize && clipView) {
      if (this.readPosition < clipView.startPosition) {
        const silenceSamples = Math.min(this.blockSize - emitted, clipView.startPosition - this.readPosition)
        this.readPosition += silenceSamples
        for (let i = 0; i < silenceSamples; ++i) {
          for (let channel = 0; channel < this.channelCount; ++channel) {
            outputBuffers[channel][emitted + i] = 0
          }
        }
        emitted += silenceSamples
      }

      let toEmit: number
      if (clipView.startPosition + clipView.length - this.readPosition < this.blockSize - emitted) {
        toEmit = clipView.startPosition + clipView.length - this.readPosition
        clipView = this.clipViews[++this.readingClipViewIndex]
      } else {
        toEmit = this.blockSize - emitted
      }

      for (let i = 0; i < toEmit; ++i) {
        for (let channel = 0; channel < this.channelCount; ++channel) {
          outputBuffers[channel][emitted + i] = this.buffer[this.bufferReadPosition + channel + i * this.channelCount]
        }
      }

      this.bufferReadPosition += toEmit * this.channelCount
      emitted += toEmit
      this.readPosition += toEmit
    }

    if (emitted < this.blockSize) {
      for (let channel = 0; channel < this.channelCount; ++channel) {
        outputBuffers[channel].fill(0, emitted)
      }
    }
  }

  async maybeFillBuffer() {
    if (
      this.bufferWritePosition - this.bufferReadPosition > this.blockSize * this.channelCount ||
      this.writingClipViewIndex >= this.clipViews.length
    ) {
      return
    }
    this.buffer.copyWithin(0, this.bufferReadPosition, this.bufferWritePosition)
    this.bufferWritePosition -= this.bufferReadPosition
    this.bufferReadPosition = 0

    let clipView = this.clipViews[this.writingClipViewIndex]
    while (this.bufferWritePosition < this.buffer.length && this.writingClipViewIndex < this.clipViews.length) {
      if (!this.clipViewFile) {
        this.writePosition = Math.max(this.startPosition, clipView.startPosition + this.writingClipInitialOffset)
        this.writingClipInitialOffset = 0
        this.clipFileOffset = clipView.offset * Float32Array.BYTES_PER_ELEMENT * this.channelCount
        this.clipViewFile = await FileSystemUtils.getReadOnlySyncAccessHandle(
          `${this.projectId}`,
          `${clipView.clip.id}`,
        )
      }
      const bufferWriteStart = this.bufferWritePosition
      const writeStart = this.writePosition
      const loaded = this.clipViewFile.read(
        new DataView(this.buffer.buffer, this.bufferWritePosition * Float32Array.BYTES_PER_ELEMENT),
        {
          at:
            this.clipFileOffset +
            (this.writePosition - clipView.startPosition) * Float32Array.BYTES_PER_ELEMENT * this.channelCount,
        },
      )
      await this.applyCrossfade(clipView, writeStart, loaded, bufferWriteStart)
      this.writePosition += loaded / Float32Array.BYTES_PER_ELEMENT / this.channelCount
      this.bufferWritePosition += loaded / Float32Array.BYTES_PER_ELEMENT

      if (this.writePosition >= clipView.length + clipView.startPosition) {
        this.bufferWritePosition -=
          (this.writePosition - (clipView.length + clipView.startPosition)) * this.channelCount
        this.clipViewFile.close()
        this.clipViewFile = null
        const nextClipView = this.clipViews[this.writingClipViewIndex + 1]
        if (nextClipView != null) {
          this.writingClipInitialOffset = Math.max(
            0,
            Math.min(nextClipView.length, clipView.startPosition + clipView.length - nextClipView.startPosition),
          )
        }
        clipView = this.clipViews[++this.writingClipViewIndex]
      }
    }
  }

  private async applyCrossfade(clipView: ClipViewSubset, writeStart: number, loaded: number, bufferWriteStart: number) {
    const nextClipView = this.clipViews[this.writingClipViewIndex + 1]
    if (nextClipView == null) {
      return
    }

    const overlapStart = nextClipView.startPosition
    const overlapEnd = Math.min(
      clipView.startPosition + clipView.length,
      nextClipView.startPosition + nextClipView.length,
    )
    const overlapLength = overlapEnd - overlapStart
    const loadedFrames = Math.min(
      loaded / Float32Array.BYTES_PER_ELEMENT / this.channelCount,
      clipView.startPosition + clipView.length - writeStart,
    )
    const crossfadeStart = Math.max(writeStart, overlapStart)
    const crossfadeEnd = Math.min(writeStart + loadedFrames, overlapEnd)
    if (overlapLength <= 0 || crossfadeStart >= crossfadeEnd) {
      return
    }

    const crossfadeFrames = crossfadeEnd - crossfadeStart
    const crossfadeBuffer = new Float32Array(crossfadeFrames * this.channelCount)
    let crossfadeFile = this.clipViewFile
    if (nextClipView.clip.id != clipView.clip.id) {
      crossfadeFile = await FileSystemUtils.getReadOnlySyncAccessHandle(`${this.projectId}`, `${nextClipView.clip.id}`)
    }
    crossfadeFile!.read(crossfadeBuffer.buffer, {
      at:
        (nextClipView.offset + crossfadeStart - nextClipView.startPosition) *
        Float32Array.BYTES_PER_ELEMENT *
        this.channelCount,
    })

    for (let frame = 0; frame < crossfadeFrames; ++frame) {
      const progress = (crossfadeStart + frame - overlapStart) / overlapLength
      const fadeOutGain = Math.cos((progress * Math.PI) / 2)
      const fadeInGain = Math.sin((progress * Math.PI) / 2)
      for (let channel = 0; channel < this.channelCount; ++channel) {
        const bufferIndex = bufferWriteStart + (crossfadeStart - writeStart + frame) * this.channelCount + channel
        const crossfadeIndex = frame * this.channelCount + channel
        this.buffer[bufferIndex] = this.buffer[bufferIndex] * fadeOutGain + crossfadeBuffer[crossfadeIndex] * fadeInGain
      }
    }

    if (crossfadeFile != this.clipViewFile) {
      crossfadeFile!.close()
    }
  }
}
