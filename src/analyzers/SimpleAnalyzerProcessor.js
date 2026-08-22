export class SimpleAnalyzerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options)
    const processorOptions = options.processorOptions ?? {}

    this.instantaneousPeakOutput = processorOptions.instantaneousPeakOutput
    this.heldPeakOutput = processorOptions.heldPeakOutput
    this.rmsOutput = processorOptions.rmsOutput

    this.updateSampleCount = Math.max(1, Math.round(processorOptions.updateSampleCount ?? (100 * sampleRate) / 1000))
    this.holdSampleCount = Math.max(
      this.updateSampleCount,
      Math.round(processorOptions.holdSampleCount ?? 1.5 * sampleRate),
    )
    this.rmsWindow = Math.max(1, Math.round(((processorOptions.rmsWindow ?? 400) * sampleRate) / 1000))

    this.samplesUntilUpdate = this.updateSampleCount
    this.channelCount = this.instantaneousPeakOutput.length
    this.currentPeak = new Float32Array(this.channelCount)

    this.peakHistory = Array.from(
      { length: this.channelCount },
      () => new Float32Array(Math.max(1, Math.ceil(this.holdSampleCount / this.updateSampleCount))),
    )
    this.peakHistoryPosition = 0

    this.rmsSquares = Array.from({ length: this.channelCount }, () => new Float32Array(this.rmsWindow))
    this.rmsSquareSum = new Float32Array(this.channelCount)
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
      for (let channel = 0; channel < this.channelCount; ++channel) {
        const sample = input[channel]?.[i] ?? 0
        const absoluteSample = Math.abs(sample)
        this.currentPeak[channel] = Math.max(this.currentPeak[channel], absoluteSample)
        this.rmsSquareSum[channel] -= this.rmsSquares[channel][this.rmsSquarePosition]
        this.rmsSquares[channel][this.rmsSquarePosition] = sample * sample
        this.rmsSquareSum[channel] += sample * sample
      }
      this.rmsSquarePosition = (this.rmsSquarePosition + 1) % this.rmsWindow
      this.rmsSampleCount = Math.min(this.rmsSampleCount + 1, this.rmsWindow)

      this.samplesUntilUpdate -= 1
      if (this.samplesUntilUpdate == 0) {
        for (let channel = 0; channel < this.channelCount; ++channel) {
          this.instantaneousPeakOutput[channel] = this.currentPeak[channel]
          this.peakHistory[channel][this.peakHistoryPosition] = this.currentPeak[channel]

          let heldPeak = 0
          for (const peak of this.peakHistory[channel]) {
            heldPeak = Math.max(heldPeak, peak)
          }
          this.heldPeakOutput[channel] = heldPeak
          this.rmsOutput[channel] = Math.sqrt(this.rmsSquareSum[channel] / this.rmsSampleCount)
          this.currentPeak[channel] = 0
        }
        this.peakHistoryPosition = (this.peakHistoryPosition + 1) % this.peakHistory[0].length
        this.samplesUntilUpdate = this.updateSampleCount
      }
    }

    return true
  }
}

registerProcessor('SimpleAnalyzerProcessor', SimpleAnalyzerProcessor)
