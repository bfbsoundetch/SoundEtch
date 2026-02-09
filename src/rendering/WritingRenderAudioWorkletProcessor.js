class WritingRenderAudioWorkletProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options)
    // Workaround for mono with https://issues.chromium.org/issues/40403559
    this.channelCount = options.processorOptions.channelCount
    this.written = false
    this.port.onmessage = (e) => {
      this.writer = e.data.writableStream.getWriter()
      this.written = true
    }
    console.log('Ready for action')
  }

  process(inputs, outputs, parameters) {
    console.error('1st')
    if (!this.copyBuffer) {
      this.copyBuffer = new Float32Array(this.channelCount * inputs[0][0].length)
      console.log(`My first frame was ${currentFrame} and my channel count is ${this.channelCount}`)
    }
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
    while (!this.written) {
      console.error('underrun')
    }
    this.written = false
    this.writer.write(this.copyBuffer).then((_) => {
      this.written = true
    })

    return true
  }
}

registerProcessor('WritingRenderAudioWorkletProcessor', WritingRenderAudioWorkletProcessor)
