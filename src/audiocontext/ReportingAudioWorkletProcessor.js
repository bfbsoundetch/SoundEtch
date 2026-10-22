class ReportingAudioWorkletProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options)
    this.position = options.processorOptions.position
    this.startPosition = this.position[0]
    if (options.processorOptions.loopEnd) {
      if (options.processorOptions.loopEnd < this.startPosition) {
        throw new Error(`Loop end ${options.processorOptions.loopEnd} is earlier than the start ${this.startPosition}`)
      }
      this.loopLength = options.processorOptions.loopEnd - this.startPosition
    } else {
      this.loopLength = 0
    }
    this.samplesProcessed = 0
  }

  process(inputs, outputs, parameters) {
    if (this.loopLength) {
      this.samplesProcessed += outputs[0][0].length
      this.position[0] = this.startPosition + (this.samplesProcessed % this.loopLength)
    } else {
      this.position[0] += outputs[0][0].length
    }
    for (let i = 0; i < inputs[0]; ++i) {
      for (let j = 0; j < inputs[0][0]; ++j) {
        outputs[0][i][j] = inputs[0][i][j]
      }
    }
    return true
  }
}

registerProcessor('ReportingAudioWorkletProcessor', ReportingAudioWorkletProcessor)
