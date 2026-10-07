export class RmsProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options)
    this.rmsWindow = Math.round(((options.processorOptions.rmsWindow ?? 400) * sampleRate) / 1000)
    this.rmsNormalizer = 1 / this.rmsWindow
    this.windowStep = Math.round(((options.processorOptions.windowStep ?? 100) * sampleRate) / 1000)
    if (this.rmsWindow % this.windowStep != 0) {
      throw new Error('rmsWindow must be a multiple of windowStep')
    }
    this.window = new Array(this.rmsWindow / this.windowStep).fill(0)
    this.windowPosition = 0
    this.output = options.processorOptions.output
    this.squareSum = 0
    this.windowSum = 0
  }

  process(inputs) {
    let printPoint = (currentFrame + inputs[0][0].length) % this.windowStep
    for (let j = 0; j < inputs[0].length; ++j) {
      for (let i = 0; i < inputs[0][0].length; ++i) {
        if (i == printPoint && j == 0) {
          this.windowSum -= this.window[this.windowPosition]
          this.window[this.windowPosition] = this.squareSum
          this.windowSum += this.window[this.windowPosition]
          this.windowPosition = (this.windowPosition + 1) % this.window.length
          this.squareSum = 0
          this.output[0] = this.windowSum * this.rmsNormalizer
        }
        this.squareSum += inputs[0][j][i] * inputs[0][j][i]
      }
    }
    return true
  }
}

registerProcessor('RmsProcessor', RmsProcessor)
