export class SimpleAnalyzerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options)
    const processorOptions = options.processorOptions ?? {}

    this.instantaneousPeakOutput = processorOptions.instantaneousPeakOutput
    this.heldPeakOutput = processorOptions.heldPeakOutput
    this.rmsOutput = processorOptions.rmsOutput

    this.updateSampleCount = Math.max(1, Math.round(processorOptions.updateSampleCount ?? (100 * sampleRate) / 1000))
    this.holdSampleCount = Math.max(this.updateSampleCount, Math.round(processorOptions.holdSampleCount ?? 1.5 * sampleRate))
    this.rmsWindow = Math.max(1, Math.round(((processorOptions.rmsWindow ?? 400) * sampleRate) / 1000))

    this.samplesUntilUpdate = this.updateSampleCount
    this.currentPeak = 0

    this.peakHistory = new Float32Array(Math.max(1, Math.ceil(this.holdSampleCount / this.updateSampleCount)))
    this.peakHistoryPosition = 0

    this.rmsSquares = new Float32Array(this.rmsWindow)
    this.rmsSquareSum = 0
    this.rmsSquarePosition = 0
    this.rmsSampleCount = 0
  }

  process(inputs, outputs) {
    const input = inputs[0]
    const output = outputs[0]

    if (!input || input.length == 0) {
      return true
    }

    if (output) {
      for (let channel = 0; channel < Math.min(input.length, output.length); ++channel) {
        output[channel].set(input[channel])
      }
    }

    for (let i = 0; i < input[0].length; ++i) {
      let samplePeak = 0
      let sampleSquareSum = 0
      for (let channel = 0; channel < input.length; ++channel) {
        const sample = input[channel][i]
        const absoluteSample = Math.abs(sample)
        samplePeak = Math.max(samplePeak, absoluteSample)
        sampleSquareSum += sample * sample
      }

      this.currentPeak = Math.max(this.currentPeak, samplePeak)

      this.rmsSquareSum -= this.rmsSquares[this.rmsSquarePosition]
      this.rmsSquares[this.rmsSquarePosition] = sampleSquareSum
      this.rmsSquareSum += sampleSquareSum
      this.rmsSquarePosition = (this.rmsSquarePosition + 1) % this.rmsSquares.length
      this.rmsSampleCount = Math.min(this.rmsSampleCount + 1, this.rmsSquares.length)

      this.samplesUntilUpdate -= 1
      if (this.samplesUntilUpdate == 0) {
        this.instantaneousPeakOutput[0] = this.currentPeak
        this.peakHistory[this.peakHistoryPosition] = this.currentPeak
        this.peakHistoryPosition = (this.peakHistoryPosition + 1) % this.peakHistory.length

        let heldPeak = 0
        for (const peak of this.peakHistory) {
          heldPeak = Math.max(heldPeak, peak)
        }
        this.heldPeakOutput[0] = heldPeak

        this.rmsOutput[0] = Math.sqrt(this.rmsSquareSum / this.rmsSampleCount)
        this.currentPeak = 0
        this.samplesUntilUpdate = this.updateSampleCount
      }
    }

    return true
  }
}

registerProcessor('SimpleAnalyzerProcessor', SimpleAnalyzerProcessor)
