import { LufsCalculator } from './LufsCalculator'

export class Analyzer {
  private levelGetter: (() => number) | null = null
  private peakGetter: (() => number) | null = null
  private heldPeakGetter: (() => number) | null = null
  private peakFindingNode: AudioWorkletNode | null = null
  private forkNode: AudioNode | null = null

  constructor(private readonly forkOutput = true) {}

  getLevel(): number {
    return this.levelGetter?.() ?? Number.NEGATIVE_INFINITY
  }

  getPeak(): number {
    return this.peakGetter?.() ?? Number.NEGATIVE_INFINITY
  }

  getHeldPeak(): number {
    return this.heldPeakGetter?.() ?? Number.NEGATIVE_INFINITY
  }

  async sendOutputTo(destination: AudioNode) {
    this.forkNode?.connect(destination)
  }

  async attachAnalyzer(inputNode: AudioNode) {
    if (this.peakFindingNode?.context == inputNode.context) {
      inputNode.connect(this.peakFindingNode)
      return
    }
    await inputNode.context.audioWorklet.addModule(new URL('./wasm/upsampled_peak.mjs', import.meta.url))
    this.peakFindingNode = new AudioWorkletNode(inputNode.context, 'PeakFindingProcessor', {
      // channelCount: inputNode.channelCount,
      // channelCountMode: 'explicit',
    })
    let { promise, resolve, reject } = Promise.withResolvers()
    this.peakFindingNode.port.onmessage = (event) => {
      if (event.data.instantaneousPeaks) {
        resolve(event.data)
      }
    }
    const peaks = (await promise) as {
      instantaneousPeaks: Float32Array
      heldPeaks: Float32Array
    }
    this.peakGetter = () => 20 * Math.log10(peaks.instantaneousPeaks[0])
    this.heldPeakGetter = () => 20 * Math.log10(peaks.heldPeaks[0])
    if (!this.forkOutput) {
      this.levelGetter = await LufsCalculator.connectToNode(inputNode.connect(this.peakFindingNode))
      return inputNode
    }
    await inputNode.context.audioWorklet.addModule(new URL('./AudioForkingProcessor.js', import.meta.url))
    this.forkNode = new AudioWorkletNode(inputNode.context, 'AudioForkingProcessor', {
      numberOfOutputs: 2,
      channelCount: 1,
      channelCountMode: 'explicit',
    })
    inputNode.connect(this.forkNode)
    this.levelGetter = await LufsCalculator.connectToNode(this.forkNode.connect(this.peakFindingNode, 1))
    return this.forkNode
  }
}
