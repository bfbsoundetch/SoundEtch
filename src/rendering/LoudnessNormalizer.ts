import { LimiterProcessor } from '../effects/limiter/LimiterProcessor'

// Applies a fixed gain followed by a true-peak lookahead limiter to an interleaved stream. The output
// is sample-aligned with the input and, after finish(), has exactly as many frames.
export class LoudnessNormalizer {
  private readonly channelCount: number
  private readonly gain: number
  private readonly limiter: LimiterProcessor
  private readonly parameters: Record<string, Float32Array>
  private inputChannels: Float32Array[] = []
  private outputChannels: Float32Array[] = []
  private framesToDrop: number

  constructor(sampleRate: number, channelCount: number, gain: number, truePeakCeilingDb: number) {
    this.channelCount = channelCount
    this.gain = gain
    this.limiter = new LimiterProcessor({ processorOptions: { sampleRate, truePeak: true } })
    const releaseDefault = LimiterProcessor.parameterDescriptors.find((d) => d.name === 'release')!.defaultValue!
    this.parameters = {
      ceiling: new Float32Array([truePeakCeilingDb]),
      release: new Float32Array([releaseDefault]),
    }
    this.framesToDrop = this.limiter.lookaheadSamples
  }

  // Interleaved in, interleaved out. The returned array is freshly allocated, so its buffer can be transferred.
  process(input: Float32Array): Float32Array<ArrayBuffer> {
    const channelCount = this.channelCount
    const frames = input.length / channelCount
    if (this.inputChannels.length === 0 || this.inputChannels[0].length < frames) {
      this.inputChannels = Array.from({ length: channelCount }, () => new Float32Array(frames))
      this.outputChannels = Array.from({ length: channelCount }, () => new Float32Array(frames))
    }

    const inputs = this.inputChannels.map((channel) => channel.subarray(0, frames))
    const outputs = this.outputChannels.map((channel) => channel.subarray(0, frames))
    for (let channel = 0; channel < channelCount; ++channel) {
      const planar = inputs[channel]
      for (let frame = 0; frame < frames; ++frame) planar[frame] = input[frame * channelCount + channel] * this.gain
    }
    this.limiter.process([inputs], [outputs], this.parameters)

    const dropped = Math.min(this.framesToDrop, frames)
    this.framesToDrop -= dropped
    const output = new Float32Array((frames - dropped) * channelCount)
    for (let channel = 0; channel < channelCount; ++channel) {
      const planar = outputs[channel]
      for (let frame = dropped; frame < frames; ++frame) {
        output[(frame - dropped) * channelCount + channel] = planar[frame]
      }
    }
    return output
  }

  // Flushes the limiter's lookahead latency.
  finish(): Float32Array<ArrayBuffer> {
    return this.process(new Float32Array(this.limiter.lookaheadSamples * this.channelCount))
  }
}
