import { ClipViewSubset } from '../playback/AudioFileReader'
import { RawDataAudioContext } from '@descript/web-audio-js'
import { Effect } from '../effects/Effects'
import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import { FileSystemSyncAccessHandle } from '../filesystem/FileSystemSyncAccessHandle'

console.error('created!!!!!')

export type TrackSubset = {
  name: string
  length: number
  channelCount: number
  clipViews: Array<ClipViewSubset>
  effects: Array<Effect>
  gain: number
  pan: number
}

export type RenderingArgument = {
  writableStream: WritableStream
  projectId: number
  sampleRate: number
  channelCount: number
  startPosition: number
  trackSubsets: Array<TrackSubset>
}

self.onmessage = async (e) => {
  console.error('started!!!')
  const argument = e.data as RenderingArgument
  // argument.channelCount = 1

  const length = argument.trackSubsets.reduce((m, t) => Math.max(m, t.length), 0)

  const blockSize = 128

  const audioContext = new RawDataAudioContext({
    sampleRate: argument.sampleRate,
    blockSize: blockSize,
    numberOfChannels: 2,
  })
  audioContext.resume()

  const writer = argument.writableStream.getWriter()

  const processors = new Array<ReadingOfflineProcessor>()

  argument.trackSubsets.forEach((track) => {
    const readingProcessorNode = audioContext.createScriptProcessor(128, 0, track.channelCount)
    const processor = new ReadingOfflineProcessor(
      argument.projectId,
      track.clipViews,
      track.channelCount,
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

  const output = new Array(argument.channelCount)
  const interleaved = argument.channelCount > 1 ? new Float32Array(blockSize * argument.channelCount) : []
  for (let i = 0; i < argument.channelCount; ++i) {
    output[i] = new Float32Array(blockSize)
  }
  for (let i = 0; i < length; i += blockSize) {
    await Promise.all(processors.map((p) => p.maybeFillBuffer()))
    audioContext.process(output)
    if (argument.channelCount > 1) {
      for (let i = 0; i < blockSize; ++i) {
        for (let channel = 0; channel < argument.channelCount; ++channel) {
          interleaved[i * argument.channelCount + channel] = output[channel][i]
        }
      }
      await writer.write(interleaved)
    } else {
      await writer.write(output[0])
    }
  }
  console.error('done')
  await writer.close()
}

class ReadingOfflineProcessor {
  private clipViewIndex = 0
  private clipView: ClipViewSubset

  private buffer = new Float32Array(300)
  private bufferReadPosition = 0
  private bufferWritePosition = 0
  private clipViewFile: FileSystemSyncAccessHandle | null = null
  private clipFileOffset = -1

  private clipViewRead = 0
  private clipViewWritten = 0
  private position

  private readonly outputBuffers: Array<Float32Array>

  constructor(
    private readonly projectId: number,
    private readonly clipViews: Array<ClipViewSubset>,
    private readonly channelCount: number,
    startPosition: number,
  ) {
    this.clipView = this.clipViews[0]
    this.position = startPosition
    this.outputBuffers = new Array<Float32Array>(channelCount)
    for (let i = 0; i < channelCount; ++i) {
      this.outputBuffers[i] = new Float32Array(128)
    }
    while (this.position >= this.clipView.startPosition + this.clipView.length) {
      console.error(`${this.position} ${this.clipView.startPosition} ${this.clipView.length}`)
      this.clipView = this.clipViews[++this.clipViewIndex]
    }
  }

  process(audioProcessingEvent: AudioProcessingEvent) {
    const output = audioProcessingEvent.outputBuffer
    let emitted = 0
    while (emitted < output.length && this.clipView) {
      if (this.position < this.clipView.startPosition) {
        emitted += this.clipView.startPosition - this.position
      }

      let toEmit: number
      if (emitted + this.clipView.length - this.clipViewRead < output.length) {
        toEmit = this.clipView.length - this.clipViewRead
        this.clipView = this.clipViews[++this.clipViewIndex]
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
      this.clipViewRead += toEmit
      emitted += toEmit
    }

    for (let channel = 0; channel < this.channelCount; ++channel) {
      output.copyToChannel(this.outputBuffers[channel], channel)
    }

    this.position += output.length
  }

  async maybeFillBuffer() {
    if (this.bufferWritePosition - this.bufferReadPosition > 128 * this.channelCount || !this.clipView) {
      return
    }
    ;(this.buffer.copyWithin(0, this.bufferReadPosition, this.bufferWritePosition),
      (this.bufferWritePosition -= this.bufferReadPosition))
    this.bufferReadPosition = 0

    let currentClipViewIndex = this.clipViewIndex
    while (currentClipViewIndex < this.clipViews.length) {
      if (!this.clipViewFile) {
        this.clipFileOffset =
          this.clipViews[currentClipViewIndex].offset * Float32Array.BYTES_PER_ELEMENT * this.clipView.clip.channelCount
        const file = await FileSystemUtils.getFileHandle(
          `${this.projectId}`,
          `${this.clipViews[currentClipViewIndex].clip.id}`,
        )
        this.clipViewFile = (await (file as any).createSyncAccessHandle()) as FileSystemSyncAccessHandle
        this.clipViewWritten = 0
      }
      const loaded = this.clipViewFile.read(
        new DataView(this.buffer.buffer, this.bufferWritePosition * Float32Array.BYTES_PER_ELEMENT),
        {
          at: this.clipFileOffset + this.clipViewWritten,
        },
      )
      // console.error(' <> ' + this.clipViewWritten + ' ' + loaded + ' '  + new Float32Array(this.buffer.buffer,
      //     this.bufferWritePosition * Float32Array.BYTES_PER_ELEMENT).reduce((m, n) => m+n))
      this.clipViewWritten += loaded
      this.bufferWritePosition += loaded / Float32Array.BYTES_PER_ELEMENT
      if (this.bufferWritePosition == this.buffer.length) {
        break
      }
      console.error(
        'uuuhhh' + loaded + ' ' + this.bufferWritePosition + ' ' + this.bufferReadPosition + ' ' + this.buffer.length,
      )
      this.clipViewWritten = 0
      this.clipViewFile.close()
      this.clipViewFile = null
      currentClipViewIndex++
    }
  }

  // async maybeFillBuffer() {
  //   if ((this.clipViewFile && this.bufferPosition < this.buffer.length) || !this.clipView) {
  //     return
  //   }
  //   if (!this.clipViewFile) {
  //     const file = await FileSystemUtils.getFileHandle(
  //       `${this.projectId}`,
  //       `${this.clipView.clip.id}`,
  //     )
  //     this.clipViewFile = await (
  //       file as any
  //     ).createSyncAccessHandle() as FileSystemSyncAccessHandle
  //   }
  //   this.clipViewFile.read(this.buffer.buffer, {
  //     at: this.clipView.offset + this.position - this.clipView.startPosition,
  //   })

  //   this.bufferPosition = 0
  // }
}
