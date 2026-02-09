export class PowerSpectralDensity {
  private readonly fftSize: number = 2048

  constructor(fftSize?: number) {
    if (!!fftSize) {
      this.fftSize = fftSize
    }
  }

  async calculatePSD(audioData: Float32Array): Promise<Float32Array> {
    // const fft = pulse.fftReal(this.fftSize)
    // const fftResult = fft.forward(audioData)
    // for (let i = 0; i < this.fftSize; ++i) {
    //   fftResult[i] = fftResult[i] * fftResult[i]
    // }
    return audioData
  }
}
