export class SimpleAnalyzer {
  private analyzerNode: AudioWorkletNode | null = null
  private rmsLevel: Float32Array | null = null
  private instantaneousPeak: Float32Array | null = null
  private heldPeak: Float32Array | null = null

  constructor(private readonly forkOutput = true) {}

  getLevel(channel = 0): number {
    return SimpleAnalyzer.linearToDb(this.rmsLevel?.[channel] ?? 0)
  }

  getPeak(channel = 0): number {
    return SimpleAnalyzer.linearToDb(this.instantaneousPeak?.[channel] ?? 0)
  }

  getHeldPeak(channel = 0): number {
    return SimpleAnalyzer.linearToDb(this.heldPeak?.[channel] ?? 0)
  }

  async sendOutputTo(destination: AudioNode) {
    if (this.forkOutput) {
      this.analyzerNode?.connect(destination)
    }
  }

  async attachAnalyzer(inputNode: AudioNode) {
    if (this.analyzerNode?.context == inputNode.context) {
      console.error('b4', this.analyzerNode.numberOfInputs)
      inputNode.connect(this.analyzerNode)
      console.error('after', this.analyzerNode.numberOfInputs)
      return this.forkOutput ? this.analyzerNode : inputNode
    }

    await inputNode.context.audioWorklet.addModule(new URL('./SimpleAnalyzerProcessor.js', import.meta.url))

    const outputByteLength = inputNode.channelCount * Float32Array.BYTES_PER_ELEMENT
    this.instantaneousPeak = new Float32Array(new SharedArrayBuffer(outputByteLength))
    this.heldPeak = new Float32Array(new SharedArrayBuffer(outputByteLength))
    this.rmsLevel = new Float32Array(new SharedArrayBuffer(outputByteLength))

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
