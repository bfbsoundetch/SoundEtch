export enum WindowFunction {
  RECTANGLE = 'RECTANGLE',
  TRIANGLE = 'TRIANGLE',
  HAMMING = 'HAMMING',
  HANN = 'HANN',
  BLACKMAN = 'BLACKMAN',
  BLACKMAN_HARRIS = 'BLACKMAN_HARRIS',
  WELCH = 'WELCH',
  GAUSSIAN = 'GAUSSIAN',
}

export class FFTWindowFunctions {
  static getWindowFunctionOptions(): Array<string> {
    return Object.keys(WindowFunction)
  }

  static getWindowFunction(windowFunction: WindowFunction): Function {
    switch (windowFunction) {
      case WindowFunction.RECTANGLE:
        return () => {}
      case WindowFunction.TRIANGLE:
        ;(audioBuffer: Float32Array) => {
          const pairs = (audioBuffer.length - 1) / 2
          const slope = 2.0 / audioBuffer.length
          for (let i = 0; i < pairs; ++i) {
            audioBuffer[i + 1] *= i * slope
            audioBuffer[audioBuffer.length - i - 1] *= i * slope
          }
        }
      case WindowFunction.HAMMING:
        ;(audioBuffer: Float32Array) => {
          const multiplier = (2 * Math.PI) / audioBuffer.length
          const coeff0 = 0.54
          const coeff1 = -0.46
          for (let i = 0; i < audioBuffer.length; ++i) {
            audioBuffer[i] *= coeff0 + coeff1 * Math.cos(i * multiplier)
          }
        }
      case WindowFunction.HANN:
        ;(audioBuffer: Float32Array) => {
          const multiplier = (2 * Math.PI) / audioBuffer.length
          const coeff0 = 0.5
          const coeff1 = -0.5
          for (let i = 0; i < audioBuffer.length; ++i) audioBuffer[i] *= coeff0 + coeff1 * Math.cos(i * multiplier)
        }
      case WindowFunction.BLACKMAN:
        return (audioBuffer: Float32Array) => {
          const alpha = 0.16
          const a0 = 0.5 * (1.0 - alpha)
          const a1 = 0.5
          const a2 = 0.5 * alpha

          for (let i = 0; i < audioBuffer.length; ++i) {
            const x = (i * 1.0) / audioBuffer.length
            const window = a0 - a1 * Math.cos(2 * Math.PI * x) + a2 * Math.cos(4 * Math.PI * x)
            audioBuffer[i] *= window
          }
        }
      case WindowFunction.BLACKMAN_HARRIS:
        return (audioBuffer: Float32Array) => {
          const multiplier = (2 * Math.PI) / audioBuffer.length
          const multiplier2 = 2 * multiplier
          const multiplier3 = 3 * multiplier
          const coeff0 = 0.35875,
            coeff1 = -0.48829,
            coeff2 = 0.14128,
            coeff3 = -0.01168
          for (let i = 0; i < audioBuffer.length; ++i) {
            audioBuffer[i] *=
              coeff0 +
              coeff1 * Math.cos(i * multiplier) +
              coeff2 * Math.cos(i * multiplier2) +
              coeff3 * Math.cos(i * multiplier3)
          }
        }
      case WindowFunction.WELCH:
        return (audioBuffer: Float32Array) => {
          for (let i = 0; i < audioBuffer.length; ++i) {
            const iOverN = (i * 1.0) / audioBuffer.length
            audioBuffer[i] *= 4 * iOverN * (1 - iOverN)
          }
        }
      case WindowFunction.GAUSSIAN:
        return (audioBuffer: Float32Array, sigma = 2.5) => {
          const A = -2 * sigma * sigma
          const N = audioBuffer.length
          for (let i = 0; i < audioBuffer.length; ++i) {
            const iOverN = i / N
            audioBuffer[i] *= Math.exp(A * (0.25 + iOverN * iOverN - iOverN))
          }
        }
    }
  }
}
