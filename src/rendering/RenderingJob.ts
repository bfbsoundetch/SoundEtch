import { ClipViewSubset } from '../playback/AudioFileReader'
import { RawDataAudioContext } from '@descript/web-audio-js'
import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import { FileSystemSyncAccessHandle } from '../filesystem/FileSystemSyncAccessHandle'
import { RenderingWorkerStartMessage } from './RenderingWorkerProtocol'

const BLOCK_SIZE = 1024
const RENDER_CHUNK_SAMPLE_CAPACITY = 1024 * 1024

self.onmessage = async (e) => {
  const { argument, encodingPort } = e.data as RenderingWorkerStartMessage

  const length = argument.length

  const audioContext = new RawDataAudioContext({
    sampleRate: argument.sampleRate,
    blockSize: BLOCK_SIZE,
    numberOfChannels: argument.channelCount,
  })
  audioContext.resume()

  const processors = new Array<ReadingOfflineProcessor>()

  argument.trackSubsets.forEach((track) => {
    const readingProcessorNode = audioContext.createScriptProcessor(BLOCK_SIZE, 0, track.channelCount)
    const processor = new ReadingOfflineProcessor(
      argument.projectId,
      track.clipViews,
      track.channelCount,
      BLOCK_SIZE,
      argument.startPosition,
    )
    processors.push(processor)
    readingProcessorNode.onaudioprocess = (e: AudioProcessingEvent) => processor.process(e)

    const gainNode = audioContext.createGain()
    gainNode.channelCount = argument.channelCount
    gainNode.channelCountMode = 'explicit'
    gainNode.channelInterpretation = 'speakers'
    gainNode.gain.value = track.gain

    readingProcessorNode.connect(gainNode, 0, 0)
    if (argument.channelCount == 1) {
      gainNode.connect(audioContext.destination, 0, 0)
    } else {
      const pannerNode = audioContext.createStereoPanner()
      pannerNode.pan.value = track.pan
      gainNode.connect(pannerNode, 0, 0)
      pannerNode.connect(audioContext.destination, 0, 0)
    }
  })

  const output = new Array<Float32Array>(argument.channelCount)
  for (let i = 0; i < argument.channelCount; ++i) {
    output[i] = new Float32Array(BLOCK_SIZE)
  }

  let pendingChunk = new Float32Array(RENDER_CHUNK_SAMPLE_CAPACITY)
  let pendingLength = 0

  const flushPendingChunk = () => {
    if (pendingLength === 0) {
      return
    }

    encodingPort.postMessage(
      {
        type: 'audio',
        buffer: pendingChunk.buffer,
        length: pendingLength,
      },
      [pendingChunk.buffer],
    )
    pendingChunk = new Float32Array(RENDER_CHUNK_SAMPLE_CAPACITY)
    pendingLength = 0
  }

  for (let i = 0; i < length; i += BLOCK_SIZE) {
    await Promise.all(processors.map((p) => p.maybeFillBuffer()))
    audioContext.process(output)

    const frameCount = Math.min(BLOCK_SIZE, length - i)
    const samplesToWrite = frameCount * argument.channelCount
    if (pendingLength + samplesToWrite > pendingChunk.length) {
      flushPendingChunk()
    }

    for (let frame = 0; frame < frameCount; ++frame) {
      for (let channel = 0; channel < argument.channelCount; ++channel) {
        pendingChunk[pendingLength++] = output[channel][frame]
      }
    }
  }

  flushPendingChunk()
  encodingPort.postMessage({ type: 'stop' })
}

class ReadingOfflineProcessor {
  private readingClipViewIndex = 0
  private writingClipViewIndex = 0
  private clipView: ClipViewSubset

  private buffer = new Float32Array(1024 * 1024)
  private bufferReadPosition = 0
  private bufferWritePosition = 0
  private clipViewFile: FileSystemSyncAccessHandle | null = null
  private clipFileOffset = -1
  private writingClipInitialOffset = 0

  private writePosition
  private readPosition

  private readonly outputBuffers: Array<Float32Array>

  constructor(
    private readonly projectId: number,
    private readonly clipViews: Array<ClipViewSubset>,
    private readonly channelCount: number,
    private readonly blockSize: number,
    private readonly startPosition: number,
  ) {
    this.clipView = this.clipViews[0]
    this.readPosition = this.writePosition = startPosition
    this.outputBuffers = new Array<Float32Array>(channelCount)
    for (let i = 0; i < channelCount; ++i) {
      this.outputBuffers[i] = new Float32Array(blockSize)
    }
    while (this.readPosition >= this.clipView.startPosition + this.clipView.length) {
      this.clipView = this.clipViews[++this.readingClipViewIndex]
    }
    this.writingClipViewIndex = this.readingClipViewIndex
  }

  process(audioProcessingEvent: AudioProcessingEvent) {
    const output = audioProcessingEvent.outputBuffer
    let emitted = 0
    let clipView = this.clipViews[this.readingClipViewIndex]
    if (!clipView) {
      for (let channel = 0; channel < this.channelCount; ++channel) {
        this.outputBuffers[channel].fill(0)
      }
    }
    while (emitted < output.length && clipView) {
      if (this.readPosition < clipView.startPosition) {
        const silenceSamples = Math.min(output.length - emitted, clipView.startPosition - this.readPosition)
        this.readPosition += silenceSamples
        for (let i = 0; i < silenceSamples; ++i) {
          for (let channel = 0; channel < this.channelCount; ++channel) {
            this.outputBuffers[channel][emitted + i] = 0
          }
        }
        emitted += silenceSamples
      }

      let toEmit: number
      if (clipView.startPosition + clipView.length - this.readPosition < output.length - emitted) {
        toEmit = clipView.startPosition + clipView.length - this.readPosition
        clipView = this.clipViews[++this.readingClipViewIndex]
      } else {
        toEmit = output.length - emitted
      }

      for (let i = 0; i < toEmit; ++i) {
        for (let channel = 0; channel < this.channelCount; ++channel) {
          this.outputBuffers[channel][emitted + i] =
            this.buffer[this.bufferReadPosition + channel + i * this.channelCount]
        }
      }

      this.bufferReadPosition += toEmit * this.channelCount
      emitted += toEmit
      this.readPosition += toEmit
    }

    if (emitted < output.length) {
      for (let channel = 0; channel < this.channelCount; ++channel) {
        this.outputBuffers[channel].fill(0, emitted)
      }
    }

    for (let channel = 0; channel < this.channelCount; ++channel) {
      output.copyToChannel(this.outputBuffers[channel] as any, channel)
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
        const file = await FileSystemUtils.getFileHandle(`${this.projectId}`, `${clipView.clip.id}`)
        this.clipViewFile = (await (file as any).createSyncAccessHandle()) as FileSystemSyncAccessHandle
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
      const file = await FileSystemUtils.getFileHandle(`${this.projectId}`, `${nextClipView.clip.id}`)
      crossfadeFile = (await (file as any).createSyncAccessHandle()) as FileSystemSyncAccessHandle
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
