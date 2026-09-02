import { AudioControl } from '../audiocontext/AudioControl'

export class LufsCalculator {
  // This logic probably originates with libebur128 https://github.com/jiixyj/libebur128
  static preFilterCoefficients(fs: number) {
    const db = 3.999843853973347
    const f0 = 1681.974450955533
    const Q = 0.7071752369554196
    const K = Math.tan((Math.PI * f0) / fs)

    const Vh = Math.pow(10, db / 20)
    const Vb = Math.pow(Vh, 0.4996667741545416)

    const denominator0 = 1 + K / Q + K * K
    const denominator1 = (2 * (K * K - 1)) / denominator0
    const denominator2 = (1 - K / Q + K * K) / denominator0
    const numerator0 = (Vh + (Vb * K) / Q + K * K) / denominator0
    const numerator1 = (2 * (K * K - Vh)) / denominator0
    const numerator2 = (Vh - (Vb * K) / Q + K * K) / denominator0

    return {
      numerators: [numerator0, numerator1, numerator2],
      denominators: [1, denominator1, denominator2],
    }
  }

  static weightingFilterCoefficients(fs: number) {
    const f0 = 38.13547087602444
    const Q = 0.5003270373238773
    const K = Math.tan((Math.PI * f0) / fs)

    const denominator1 = (2 * (K * K - 1)) / (1 + K / Q + K * K)
    const denominator2 = (1 - K / Q + K * K) / (1 + K / Q + K * K)
    const numerator0 = 1
    const numerator1 = -2
    const numerator2 = 1

    return {
      numerators: [numerator0, numerator1, numerator2],
      denominators: [1, denominator1, denominator2],
    }
  }

  static async connectToNode(node: AudioNode, outputIndex: number = 0): Promise<() => number> {
    const context = node.context
    const level = new Float32Array(new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT))
    const pre = this.preFilterCoefficients(context.sampleRate)
    const weights = this.weightingFilterCoefficients(context.sampleRate)
    const prefilter = context.createIIRFilter(pre.numerators, pre.denominators)
    const filter = context.createIIRFilter(weights.numerators, weights.denominators)
    await context.audioWorklet.addModule(new URL('./RmsProcessor.js', import.meta.url))
    node
      .connect(prefilter, outputIndex)
      .connect(filter)
      .connect(
        new AudioWorkletNode(context, 'RmsProcessor', {
          channelCount: node.channelCount,
          channelCountMode: 'explicit',
          processorOptions: {
            output: level,
          },
        }),
      )

    return () => this.applyLoudness(level[0])
  }

  private static applyLoudness(n: number) {
    return -0.691 + 10 * Math.log10(n)
  }
}
