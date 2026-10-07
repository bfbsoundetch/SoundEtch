import { RingBuffer } from 'ringbuf.js'

export class FilePlayingAudioWorkletProcessor extends AudioWorkletProcessor {
  static RENDER_QUANTUM = 128

  constructor(options) {
    super()
    this.dataRingBuffer = new RingBuffer(options.processorOptions.ringBufferArray, Float32Array)
    this.outputBuffer = new Float32Array(8 * 1024)
    this.bufferOffset = 0
    this.bufferFilledLength = 0

    this.startPosition = options.processorOptions.startPosition ?? 0

    this.underrunBits = options.processorOptions.underrunBits
    this.bitmask = new BigUint64Array(1)
    this.index = options.processorOptions.index
    // We use the negated version since it is used more often in `process`.
    this.bitmask[0] = ~(1n << BigInt(options.processorOptions.index))

    // When we run out of data, we need to keep our sample position in alignment
    // with the other tracks. Since we flag that we ran out of data only after
    // partially filling the output buffer, the other tracks processed afterward
    // will skip a full buffer's worth. Therefore, we store the number of samples
    // in the output buffer before we ran out, and once we get enough data to send,
    // we'll pad the output by this amount first.
    this.positionAtUnderrun = -1

    this.length = options.processorOptions.length
    this.silenceLength = 0
  }

  process(_, [outputs]) {
    // If any bit is 1, there's a track with an underrun
    if (this.underrunBits[0]) {
      // If our bitmask changes this.underrunBits, our bit is one of the 1s.
      if ((this.underrunBits[0] & this.bitmask[0]) == this.underrunBits[0] || !this.dataRingBuffer.availableRead()) {
        // Some other track has underrun, so we need to wait
        return true
      }
      // Clear our bit, indicating no underrun
      this.underrunBits[0] &= this.bitmask[0]
      this.silenceLength = this.positionAtUnderrun
      this.positionAtUnderrun = 0
    }

    let i = Math.min(FilePlayingAudioWorkletProcessor.RENDER_QUANTUM, this.silenceLength)
    this.silenceLength -= i

    for (; i < FilePlayingAudioWorkletProcessor.RENDER_QUANTUM; ++i) {
      if (this.bufferOffset == this.bufferFilledLength) {
        this.bufferOffset = 0
        this.bufferFilledLength = this.dataRingBuffer.pop(this.outputBuffer)
        if (!this.bufferFilledLength) {
          console.debug(
            'Not enough data ready for track ' +
              this.index +
              ' at current frame ' +
              (this.startPosition + currentFrame),
          )
          if (this.startPosition + currentFrame + i >= this.length) {
            console.debug("...because we're done reading!")
            this.port.postMessage({ type: 'finished' })
            return false // done
          }
          this.underrunBits[0] |= ~this.bitmask[0]
          this.positionAtUnderrun = i
          return true
        }
      }

      // NaN indicates that the next value is the number of silent samples
      if (Number.isNaN(this.outputBuffer[this.bufferOffset])) {
        // corner case in which the NaN is at the end of the buffer
        if (this.bufferOffset == this.bufferFilledLength - 1) {
          this.bufferOffset = -1 // will be updated immediately after this
          this.bufferFilledLength = this.dataRingBuffer.pop(this.outputBuffer)
        }
        this.silenceLength = this.outputBuffer[this.bufferOffset + 1]
        this.bufferOffset += 2

        const remainingQuantum = FilePlayingAudioWorkletProcessor.RENDER_QUANTUM - i
        i += this.silenceLength - 1
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

registerProcessor('filePlayingProcessor', FilePlayingAudioWorkletProcessor)
