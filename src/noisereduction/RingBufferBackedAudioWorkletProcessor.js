import { RingBuffer, AudioReader, AudioWriter } from 'ringbuf.js'

class RingBufferBackedAudioWorkletProcessor extends AudioWorkletProcessor {
  underrunCount = 0
  overrunCount = 0

  rmsIn = 0
  rmsOut = 0

  constructor(options) {
    super()

    // Staging buffer to interleave the audio data.
    const rawSab = options.processorOptions.rawSab
    const denoisedSab = options.processorOptions.denoisedSab
    this._audio_writer = new AudioWriter(new RingBuffer(rawSab, Float32Array))
    this._audio_reader = new AudioReader(new RingBuffer(denoisedSab, Float32Array))
  }

  process([input], [output]) {
    if (input.length == 0 || output.length == 0) {
      return false
    }
    if (currentFrame % 480_000 < 128) {
      console.trace('heartbeat: in RMS ' + this.rmsIn + ' out ' + this.rmsOut)
      this.rmsIn = 0
      this.rmsOut = 0
    }
    // interleave and store in the queue
    if (this._audio_writer.enqueue(input[0]) !== 128 && ++this.overrunCount > 512) {
      throw new Error('Noise cancellation buffer overran too many times in a row.')
    }

    if (this._audio_reader.availableRead() >= 128) {
      this._audio_reader.dequeue(output[0])
      this.underrunCount = 0
    } else if (++this.underrunCount > 32) {
      throw new Error('Noise cancellation buffer underran too many times in a row.')
    }

    this.rmsIn += input[0].reduce((a, c) => a + c * c)
    this.rmsOut += output[0].reduce((a, c) => a + c * c)

    return true
  }
}

registerProcessor('RingBufferBackedProcessor', RingBufferBackedAudioWorkletProcessor)
