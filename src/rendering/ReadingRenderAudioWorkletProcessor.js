import { RingBuffer } from 'ringbuf.js'

export class ReadingRenderAudioWorkletProcessor extends AudioWorkletProcessor {
  static RENDER_QUANTUM = 128

  constructor(options) {
    super()
    this.dataRingBuffer = new RingBuffer(options.processorOptions.ringBufferArray, Float32Array)
    this.outputBuffer = new Float32Array(8 * 1024)
    this.bufferOffset = 0
    this.bufferFilledLength = 0

    this.startPosition = options.processorOptions.startPosition ?? 0

    this.length = options.processorOptions.length
    this.silenceLength = 0
  }

  process(_, [outputs]) {
    let i = Math.min(ReadingRenderAudioWorkletProcessor.RENDER_QUANTUM, this.silenceLength)
    this.silenceLength -= i

    for (; i < ReadingRenderAudioWorkletProcessor.RENDER_QUANTUM; ++i) {
      if (this.bufferOffset == this.bufferFilledLength) {
        this.bufferOffset = 0
        while (!(this.bufferFilledLength = this.dataRingBuffer.pop(this.outputBuffer))) {
          // console.debug(
          //   'Not enough data ready for track at current frame ' +
          //     (this.startPosition + currentFrame) + ' ' + this.bufferFilledLength,
          // )
          if (this.startPosition + currentFrame + i >= this.length) {
            console.debug("...because we're done reading!")
            this.port.postMessage({ type: 'finished' })
            return false // done
          }
        }
      }

      // decodeAudioData can produce values slightly outside [-1,1]
      if (this.outputBuffer[this.bufferOffset] >= 2) {
        this.silenceLength = this.outputBuffer[this.bufferOffset] / 2
        ++this.bufferOffset

        const remainingQuantum = ReadingRenderAudioWorkletProcessor.RENDER_QUANTUM - i
        i += this.silenceLength
        this.silenceLength -= Math.min(remainingQuantum, this.silenceLength)
        continue
      }
      for (let channel = 0; channel < outputs.length; ++channel) {
        outputs[channel][i] = this.outputBuffer[this.bufferOffset + channel]
      }
      this.bufferOffset += outputs.length
    }

    return true
  }
}

registerProcessor('readingRenderProcessor', ReadingRenderAudioWorkletProcessor)
