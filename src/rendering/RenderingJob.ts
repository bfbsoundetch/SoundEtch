import { ClipViewSubset } from '../playback/AudioFileReader'
import { RawDataAudioContext } from '@descript/web-audio-js'
import type { api } from '@descript/web-audio-js'
import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import { FileSystemSyncAccessHandle } from '../filesystem/FileSystemSyncAccessHandle'
import { RenderingWorkerStartMessage } from './RenderingWorkerProtocol'
import { createRenderingAudioSource } from './RenderingAudioSource'
import type { RenderingAudioSource } from './RenderingAudioSource'
import { scheduleParameterValues } from '../effects/ParameterScheduling'
import {
  BoostEffectMetadata,
  CompressionEffectMetadata,
  FadeEffectMetadata,
  NoiseReductionEffectMetadata,
  DeesserEffectMetadata,
  LimiterEffectMetadata,
  GateEffectMetadata,
} from '../effects/BuiltinEffectMetadata'
import { EqualizerEffectMetadata } from '../effects/equalizer/EqualizerMetadata'
import { BoostEffect, FadeEffect } from '../effects/gain/GainEffects'
import { NoiseReductionEffect } from '../effects/noisereduction/NoiseReductionEffect'
import type { EffectModule } from '../effects/Effect'
import { CompressionEffect } from '../effects/compression/CompressionEffect'
import { EqualizerEffect } from '../effects/equalizer/EqualizerEffect'
import { DeesserEffect } from '../effects/deesser/DeesserEffect'
import { LimiterEffect } from '../effects/limiter/LimiterEffect'
import { GateEffect } from '../effects/gate/GateEffect'

const BLOCK_SIZE = 1024
const RENDER_CHUNK_SAMPLE_CAPACITY = 1024 * 1024
// Consumers report progress per chunk. Slow effects such as noise reduction take seconds to fill a whole
// chunk, so a partial chunk is posted once this much time has passed since the last one.
const RENDER_CHUNK_MAX_INTERVAL_MS = 100

self.onmessage = async (e) => {
  const { argument, encodingPort } = e.data as RenderingWorkerStartMessage

  const length = argument.length

  const audioContext = new RawDataAudioContext({
    sampleRate: argument.sampleRate,
    blockSize: BLOCK_SIZE,
    numberOfChannels: argument.channelCount,
  })
  audioContext.resume()

  const trackSources = new Array<RenderingAudioSource & { processor: ReadingOfflineProcessor }>()
  const connectedEffectModules = new Array<EffectModule>()

  for (const track of argument.trackSubsets) {
    const processor = new ReadingOfflineProcessor(
      argument.projectId,
      track.clipViews,
      track.channelCount,
      BLOCK_SIZE,
      argument.startPosition,
    )
    const source = createRenderingAudioSource(audioContext, track.channelCount)
    trackSources.push({ ...source, processor })

    const effectModules = new Array<EffectModule>()
    for (const effectData of track.effects) {
      if (effectData.bypassed) {
        continue
      }
      const effectModule = getRenderingEffect(effectData.id)
      if (!effectModule) {
        console.error(`Effect ${effectData.id} is unavailable`)
        continue
      }
      const context = audioContext as unknown as BaseAudioContext
      effectModule.setState?.(effectData.state)
      const parameters = await effectModule.getParameters(context)
      for (const [name, sequence] of Object.entries(effectData.params)) {
        const parameter = parameters[name]
        if (parameter) {
          scheduleParameterValues(parameter, sequence, context, argument.startPosition)
        }
      }
      effectModules.push(effectModule)
    }

    const gainNode = audioContext.createGain()
    gainNode.channelCount = argument.channelCount
    gainNode.channelCountMode = 'explicit'
    gainNode.channelInterpretation = 'speakers'
    gainNode.gain.value = track.gain

    let chainInput: AudioNode = gainNode as unknown as AudioNode
    for (const effectModule of effectModules.toReversed()) {
      chainInput = await effectModule.connect(audioContext as unknown as BaseAudioContext, chainInput)
      connectedEffectModules.push(effectModule)
    }
    // Effect modules use DOM node types while this renderer uses web-audio-js nodes.
    const sourceDestination = chainInput as unknown as api.AudioNode
    source.node.connect(sourceDestination, 0, 0)
    if (argument.channelCount == 1) {
      gainNode.connect(audioContext.destination, 0, 0)
    } else {
      const pannerNode = audioContext.createStereoPanner()
      pannerNode.pan.value = track.pan
      gainNode.connect(pannerNode, 0, 0)
      pannerNode.connect(audioContext.destination, 0, 0)
    }
  }

  const output = new Array<Float32Array>(argument.channelCount)
  for (let i = 0; i < argument.channelCount; ++i) {
    output[i] = new Float32Array(BLOCK_SIZE)
  }

  const pendingChunk = new Float32Array(RENDER_CHUNK_SAMPLE_CAPACITY)
  let pendingLength = 0
  let lastFlushTime = performance.now()

  const flushPendingChunk = () => {
    if (pendingLength === 0) {
      return
    }

    const chunk = pendingChunk.slice(0, pendingLength)
    encodingPort.postMessage(
      {
        type: 'audio',
        buffer: chunk.buffer,
        length: pendingLength,
      },
      [chunk.buffer],
    )
    pendingLength = 0
    lastFlushTime = performance.now()
  }

  for (let i = 0; i < length; i += BLOCK_SIZE) {
    await Promise.all(trackSources.map(({ processor }) => processor.maybeFillBuffer()))
    for (const { channelData, processor } of trackSources) {
      processor.process(channelData)
    }
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

    if (performance.now() - lastFlushTime >= RENDER_CHUNK_MAX_INTERVAL_MS) {
      flushPendingChunk()
    }
  }

  trackSources.forEach(({ node }) => node.disconnect())
  connectedEffectModules.forEach((effectModule) => effectModule.disconnect())
  flushPendingChunk()
  encodingPort.postMessage({ type: 'stop' })
}

function getRenderingEffect(id: string): EffectModule | null {
  switch (id) {
    case FadeEffectMetadata.id:
      return new FadeEffect()
    case BoostEffectMetadata.id:
      return new BoostEffect()
    case NoiseReductionEffectMetadata.id:
      return new NoiseReductionEffect()
    case CompressionEffectMetadata.id:
      return new CompressionEffect()
    case DeesserEffectMetadata.id:
      return new DeesserEffect()
    case LimiterEffectMetadata.id:
      return new LimiterEffect()
    case GateEffectMetadata.id:
      return new GateEffect()
    case EqualizerEffectMetadata.id:
      return new EqualizerEffect()
    default:
      return null
  }
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
