import { NoiseReducer } from '../noisereduction/NoiseReducer'
import { SimpleAnalyzer } from '../analyzers/SimpleAnalyzer'
import { AudioInput } from './AudioInput'

export class MediaStreamInput implements AudioInput {
  readonly channelCount = 1
  private mediaStreamTrack: MediaStreamTrack | null = null
  private sourceNode: MediaStreamAudioSourceNode | null = null
  private noiseReducer: NoiseReducer | null = null
  private analyzer: SimpleAnalyzer
  isReducingNoise = false

  constructor(
    readonly id: string,
    readonly name: string,
    private readonly supportsNoiseReduction: boolean,
  ) {
    this.analyzer = new SimpleAnalyzer()
  }

  getLevel(channel = 0): number {
    return this.analyzer.getLevel(channel)
  }
  getPeak(channel = 0): number {
    return this.analyzer.getPeak(channel)
  }
  getHeldPeak(channel = 0): number {
    return this.analyzer.getHeldPeak(channel)
  }

  async init(context: AudioContext) {
    if (this.mediaStreamTrack && this.sourceNode?.context != context && context.state != 'closed') {
      this.sourceNode = context.createMediaStreamSource(new MediaStream([this.mediaStreamTrack]))
      this.sourceNode.channelCount = this.channelCount
      if (this.supportsNoiseReduction) {
        const noiseReducerResult = await this.getNoiseReducer().reduceNoiseFrom(this.sourceNode)
        if (noiseReducerResult) {
          await this.analyzer.attachAnalyzer(this.getNoiseReducer().noiseReducerNode!)
          this.isReducingNoise = true
        } else {
          await this.analyzer.attachAnalyzer(this.sourceNode)
        }
      } else {
        await this.analyzer.attachAnalyzer(this.sourceNode)
      }
    }
  }

  async connect(destination: AudioNode) {
    await this.init(destination.context as AudioContext)
    this.analyzer.sendOutputTo(destination)
  }

  async toggleNoiseReduction() {
    if (this.isReducingNoise) {
      this.disableNoiseReduction()
    } else {
      this.enableNoiseReduction()
    }
  }

  private async enableNoiseReduction() {
    if (!this.sourceNode) {
      return
    }
    await this.getNoiseReducer().reduceNoiseFrom(this.sourceNode)
    this.analyzer.attachAnalyzer(this.getNoiseReducer().noiseReducerNode!)
    this.isReducingNoise = true
  }

  private async disableNoiseReduction() {
    this.noiseReducer?.disconnect()
    this.analyzer.attachAnalyzer(this.sourceNode!)
    this.isReducingNoise = false
  }

  stop(): void {
    this.mediaStreamTrack?.stop()
    this.sourceNode?.disconnect()
    this.noiseReducer?.disconnect()
  }

  mute(): void {
    if (this.mediaStreamTrack) {
      this.mediaStreamTrack.enabled = false
    }
  }

  unmute(): void {
    if (this.mediaStreamTrack) {
      this.mediaStreamTrack.enabled = false
    }
  }

  async updateMediaStreamTrack(mediaStreamTrack: MediaStreamTrack) {
    if (mediaStreamTrack.kind != 'audio') {
      throw new Error('Not an audio track!')
    }
    this.mediaStreamTrack = mediaStreamTrack
    if (this.sourceNode) {
      const context = this.sourceNode.context as AudioContext
      this.sourceNode = null
      await this.init(context)
    }
  }

  private getNoiseReducer(): NoiseReducer {
    if (this.noiseReducer) {
      return this.noiseReducer
    }
    return (this.noiseReducer = new NoiseReducer())
  }
}
