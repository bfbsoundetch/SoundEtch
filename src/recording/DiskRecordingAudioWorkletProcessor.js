import { RingBuffer } from 'ringbuf.js'

class DiskRecordingAudioWorkletProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options)
    this.dataRingBuffer = new RingBuffer(options.processorOptions.ringBufferArray, Float32Array)
    // Workaround for mono with https://issues.chromium.org/issues/40403559
    this.channelCount = options.processorOptions.channelCount
    this.overrunSampleCount = options.processorOptions.overrunSampleCount
    console.log('Ready for action')
    const QUANTUM_SIZE = 128
    this.copyBuffer = new Float32Array(QUANTUM_SIZE * this.channelCount)
  }

  process(inputs, outputs, parameters) {
    if (inputs.length > 0 && inputs[0].length > 0) {
      for (let channel = 0; channel < this.channelCount; ++channel) {
        for (let i = 0; i < inputs[0][0].length; ++i) {
          this.copyBuffer[i * this.channelCount + channel] = inputs[0][channel][i]
        }
      }
      for (let input = 1; input < inputs.length; ++input) {
        for (let channel = 0; channel < this.channelCount; ++channel) {
          for (let i = 0; i < inputs[0][0].length; ++i) {
            this.copyBuffer[i * this.channelCount + channel] += inputs[input][channel][i]
          }
        }
      }
    } else {
      console.error('you have', inputs.length, 'inputs')
      this.copyBuffer.fill(0)
    }
    const pushed = this.dataRingBuffer.push(this.copyBuffer, this.copyBuffer.length)
    if (pushed != this.copyBuffer.length) {
      console.error(`Pushed ${pushed}, but buffer length was ${this.copyBuffer.length}`)
      Atomics.add(this.overrunSampleCount, 0, this.copyBuffer.length - pushed)
    }

    return true
  }
}

registerProcessor('DiskRecordingAudioWorkletProcessor', DiskRecordingAudioWorkletProcessor)
