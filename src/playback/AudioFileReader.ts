import { Logger } from '../global/Logger'
import { FileSystemSyncAccessHandle } from '../filesystem/FileSystemSyncAccessHandle'
import { RingBuffer } from 'ringbuf.js'
import { AudioFileCache } from './AudioFileCache'

export interface ClipViewSubset {
  startPosition: number
  offset: number
  length: number
  clip: { id: number; channelCount: number }
}

export class AudioFileReader {
  private static MAX_EXACT_FLOAT32_INT = 8388608

  private readonly logger = new Logger('AudioFileReader')

  private clipViewIndex: number = 0
  private isStopped: boolean = false
  private initialOffset: number = 0
  private position: number = 0
  private pausePromise: Promise<any> | null = null
  private resumeResolver: ((_: any) => any) | null = null
  private ringBuffer: RingBuffer
  private activeFileHandle: FileSystemSyncAccessHandle | null = null
  readyPromise: Promise<any>
  private readyResolver: Function | null = null // will always be set in constructor
  private waitPromiseWithResolvers = Promise.withResolvers()

  constructor(
    private readonly projectName: string,
    private startPosition: number,
    private readonly endSample: number,
    private readonly clipViews: Array<ClipViewSubset>,
    private readonly sampleRate: number,
    private readonly loop: boolean,
    ringBufferArray: SharedArrayBuffer,
  ) {
    this.ringBuffer = new RingBuffer(ringBufferArray, Float32Array)
    this.readyPromise = new Promise((resolve) => (this.readyResolver = resolve))
  }

  pause() {
    this.pausePromise = new Promise((resolve, _) => {
      this.resumeResolver = resolve
    })
  }

  resume() {
    if (this.resumeResolver) {
      this.resumeResolver('')
    }
  }

  stop() {
    this.waitPromiseWithResolvers.resolve('')
    this.isStopped = true
    this.resume()
  }

  async runBufferFillingLoopInternal(id: string) {
    const readBuffer = new Float32Array(32 * 1024)
    do {
      this.setPosition(this.startPosition)
      while (this.position < this.endSample && this.clipViewIndex < this.clipViews.length) {
        const clipView = this.clipViews[this.clipViewIndex]

        // Push pairs of (NaN, number of silent samples)
        const silenceSamples = Math.min(this.endSample - this.position, clipView.startPosition - this.position)
        if (silenceSamples > 0) {
          const bufferToPush = new Float32Array(2 * Math.ceil(silenceSamples / AudioFileReader.MAX_EXACT_FLOAT32_INT))
          for (let i = 0; i < bufferToPush.length; i += 2) {
            bufferToPush[i] = Number.NaN
            bufferToPush[i + 1] = AudioFileReader.MAX_EXACT_FLOAT32_INT
          }
          bufferToPush[bufferToPush.length - 1] = silenceSamples % AudioFileReader.MAX_EXACT_FLOAT32_INT
          while (this.ringBuffer.availableWrite() < bufferToPush.length) {
            await Promise.resolve(null)
          }
          this.ringBuffer.push(bufferToPush)
        }
        let msToPlaySilence = (silenceSamples / this.sampleRate) * 1000

        var samplesToPush =
          Math.min(this.endSample - this.position, clipView.length - this.initialOffset) * clipView.clip.channelCount

        const clipInitialOffset = this.initialOffset
        const nextClipView = this.clipViews[this.clipViewIndex + 1]
        const overlapStart = nextClipView == null ? 0 : nextClipView.startPosition
        const overlapEnd =
          nextClipView == null
            ? 0
            : Math.min(clipView.startPosition + clipView.length, nextClipView.startPosition + nextClipView.length)
        const overlapLength = overlapEnd - overlapStart
        const crossfadeFileHandle =
          overlapLength > 0 ? await AudioFileCache.getHandle(`${this.projectName}`, `${nextClipView.clip.id}`) : null
        this.activeFileHandle = await AudioFileCache.getHandle(`${this.projectName}`, `${clipView.clip.id}`)
        this.logger.debug(`File reading worker opened ${this.projectName}/${clipView.clip.id}`)
        var filePosition =
          (this.initialOffset + clipView.offset) * Float32Array.BYTES_PER_ELEMENT * clipView.clip.channelCount
        this.initialOffset = 0
        var bytesRead = 0
        var totalSamplesRead = 0
        do {
          this.logger.debug(`Reading from position ${filePosition}`)
          bytesRead = this.activeFileHandle!.read(readBuffer.buffer, {
            at: filePosition,
          })
          filePosition += bytesRead
          const samplesRead = Math.min(bytesRead / Float32Array.BYTES_PER_ELEMENT, samplesToPush)
          const framesRead = samplesRead / clipView.clip.channelCount
          const bufferStartPosition =
            clipView.startPosition + clipInitialOffset + totalSamplesRead / clipView.clip.channelCount

          // Handle crossfades
          const crossfadeStartPosition = Math.max(bufferStartPosition, overlapStart)
          const crossfadeEndPosition = Math.min(bufferStartPosition + framesRead, overlapEnd)
          if (crossfadeFileHandle != null && crossfadeStartPosition < crossfadeEndPosition) {
            const crossfadeFrames = crossfadeEndPosition - crossfadeStartPosition
            const crossfadeBuffer = new Float32Array(crossfadeFrames * clipView.clip.channelCount)
            crossfadeFileHandle.read(crossfadeBuffer.buffer, {
              at:
                (nextClipView.offset + crossfadeStartPosition - nextClipView.startPosition) *
                Float32Array.BYTES_PER_ELEMENT *
                nextClipView.clip.channelCount,
            })
            for (let frame = 0; frame < crossfadeFrames; ++frame) {
              const position = crossfadeStartPosition + frame
              const progress = (position - overlapStart) / overlapLength
              const fadeOutGain = Math.cos((progress * Math.PI) / 2)
              const fadeInGain = Math.sin((progress * Math.PI) / 2)
              for (let channel = 0; channel < clipView.clip.channelCount; ++channel) {
                const readBufferIndex =
                  (crossfadeStartPosition - bufferStartPosition + frame) * clipView.clip.channelCount + channel
                const crossfadeBufferIndex = frame * clipView.clip.channelCount + channel
                readBuffer[readBufferIndex] =
                  readBuffer[readBufferIndex] * fadeOutGain + crossfadeBuffer[crossfadeBufferIndex] * fadeInGain
              }
            }
          }

          let bufferOffset = 0
          while (true) {
            await this.pausePromise
            if (this.isStopped) {
              return
            }
            const samplesPushed = this.ringBuffer.push(
              readBuffer,
              Math.min(bytesRead / Float32Array.BYTES_PER_ELEMENT - bufferOffset, samplesToPush),
              bufferOffset,
            )
            this.readyResolver!()
            samplesToPush -= samplesPushed
            totalSamplesRead += samplesPushed
            bufferOffset += samplesPushed
            if (bufferOffset == bytesRead / Float32Array.BYTES_PER_ELEMENT || samplesToPush == 0) {
              break
            }

            const timeout = Math.max(msToPlaySilence - 250, 10)
            msToPlaySilence = 0 // done with the silenceSamples
            setTimeout(this.waitPromiseWithResolvers.resolve, timeout)
            await this.waitPromiseWithResolvers.promise
            this.waitPromiseWithResolvers = Promise.withResolvers()
          }
        } while (samplesToPush > 0 && bytesRead > 0)
        this.logger.debug('Finished reading a clipView for ' + totalSamplesRead)

        ++this.clipViewIndex
        if (overlapLength > 0) {
          this.initialOffset = Math.min(overlapLength, nextClipView.length)
        }

        this.position = Math.max(this.position, clipView.startPosition + clipView.length)
      }
    } while (this.loop)
    this.logger.debug('Finished reading this track.')
    this.readyResolver!() // in case we never hit it before
  }

  async runBufferFillingLoop() {
    const id = Date.now()
    try {
      await this.runBufferFillingLoopInternal(id.toString())
    } catch (e: any) {
      this.logger.errorMessage(e)
      postMessage({ error: e, type: 'error' })
    } finally {
      this.resumeResolver?.('')
      this.resumeResolver = null
    }
  }

  private setPosition(position: number) {
    this.clipViewIndex = 0
    this.position = position
    while (this.clipViewIndex < this.clipViews.length && this.clipViews[this.clipViewIndex].startPosition < position) {
      const clipView = this.clipViews[this.clipViewIndex]
      if (clipView.startPosition + clipView.length > position) {
        this.initialOffset = position - clipView.startPosition
        break
      }
      ++this.clipViewIndex
    }
  }
}
