class ReportingAudioWorkletProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options)
    this.position = options.processorOptions.position
  }

  process(inputs, outputs, parameters) {
    this.position[0] += outputs[0][0].length
    for (let i = 0; i < inputs[0]; ++i) {
      for (let j = 0; j < inputs[0][0]; ++j) {
        outputs[0][i][j] = inputs[0][i][j]
      }
    }
    return true
  }
}

registerProcessor('ReportingAudioWorkletProcessor', ReportingAudioWorkletProcessor)
