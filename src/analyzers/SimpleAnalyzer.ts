export class SimpleAnalyzer {
  private analyzerNode: AudioWorkletNode | null = null
  private rmsLevel: Float32Array | null = null
  private instantaneousPeak: Float32Array | null = null
  private heldPeak: Float32Array | null = null

  constructor(private readonly forkOutput = true) {}

  getLevel(): number {
    return SimpleAnalyzer.linearToDb(this.rmsLevel?.[0] ?? 0)
  }

  getPeak(): number {
    return SimpleAnalyzer.linearToDb(this.instantaneousPeak?.[0] ?? 0)
  }

  getHeldPeak(): number {
    return SimpleAnalyzer.linearToDb(this.heldPeak?.[0] ?? 0)
  }

  async sendOutputTo(destination: AudioNode) {
    if (this.forkOutput) {
      this.analyzerNode?.connect(destination)
    }
  }

  async attachAnalyzer(inputNode: AudioNode) {
    if (this.analyzerNode?.context == inputNode.context) {
      inputNode.connect(this.analyzerNode)
      return this.forkOutput ? this.analyzerNode : inputNode
    }

    await inputNode.context.audioWorklet.addModule(new URL('./SimpleAnalyzerProcessor.js', import.meta.url))

    this.instantaneousPeak = new Float32Array(new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT))
    this.heldPeak = new Float32Array(new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT))
    this.rmsLevel = new Float32Array(new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT))

    const nodeOptions: AudioWorkletNodeOptions = {
      channelCount: inputNode.channelCount,
      channelCountMode: 'explicit',
      numberOfOutputs: this.forkOutput ? 1 : 0,
      processorOptions: {
        instantaneousPeakOutput: this.instantaneousPeak,
        heldPeakOutput: this.heldPeak,
        rmsOutput: this.rmsLevel,
      },
    }
    if (this.forkOutput) {
      nodeOptions.outputChannelCount = [inputNode.channelCount]
    }

    this.analyzerNode = new AudioWorkletNode(inputNode.context, 'SimpleAnalyzerProcessor', nodeOptions)

    inputNode.connect(this.analyzerNode)
    return this.forkOutput ? this.analyzerNode : inputNode
  }

  private static linearToDb(value: number) {
    if (value <= 0) {
      return Number.NEGATIVE_INFINITY
    }
    return 20 * Math.log10(value)
  }
}
