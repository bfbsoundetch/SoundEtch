import { RingBuffer } from 'ringbuf.js'

class DiskRecordingAudioWorkletProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options)
    this.dataRingBuffer = new RingBuffer(options.processorOptions.ringBufferArray, Float32Array)
    // Workaround for mono with https://issues.chromium.org/issues/40403559
    this.channelCount = options.processorOptions.channelCount
    this.overrunSampleCount = options.processorOptions.overrunSampleCount
    console.log('Ready for action')
  }

  process(inputs, outputs, parameters) {
    if (!this.copyBuffer) {
      this.copyBuffer = new Float32Array(this.channelCount * inputs[0][0].length)
      console.log(`My first frame was ${currentFrame} and my channel count is ${this.channelCount}`)
    }
    if (inputs[0].length == 0) {
      return false
    }
    for (let channel = 0; channel < this.channelCount; ++channel) {
      for (let i = 0; i < inputs[0][0].length; ++i) {
        this.copyBuffer[i * this.channelCount + channel] = inputs[0][channel][i]
      }
    }
    if (inputs.length > 1) {
      for (let input = 1; input < inputs.length; ++input) {
        for (let channel = 0; channel < this.channelCount; ++channel) {
          for (let i = 0; i < inputs[0][0].length; ++i) {
            this.copyBuffer[i * this.channelCount + channel] += inputs[input][channel][i]
          }
        }
      }
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
