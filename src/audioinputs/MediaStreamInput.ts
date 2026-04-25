import { NoiseReducer } from '../noisereduction/NoiseReducer'
import { SimpleAnalyzer } from '../analyzers/SimpleAnalyzer'
import { AudioInput } from './AudioInput'

export class MediaStreamInput implements AudioInput {
  readonly name: string
  readonly channelCount: number
  private sourceNode: MediaStreamAudioSourceNode | null = null
  private noiseReducer: NoiseReducer | null = null
  private analyzer: SimpleAnalyzer
  isReducingNoise = false

  constructor(
    readonly id: string,
    private readonly mediaStreamTrack: MediaStreamTrack,
    private readonly supportsNoiseReduction: boolean,
  ) {
    if (mediaStreamTrack.kind != 'audio') {
      throw new Error('Not an audio track!')
    }
    this.channelCount = mediaStreamTrack.getSettings().channelCount ?? 1
    this.name = mediaStreamTrack.label
    this.analyzer = new SimpleAnalyzer()
  }

  getLevel(): number {
    return this.analyzer.getLevel()
  }
  getPeak(): number {
    return this.analyzer.getPeak()
  }
  getHeldPeak(): number {
    return this.analyzer.getHeldPeak()
  }

  async init(context: AudioContext) {
    if (this.sourceNode?.context != context) {
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
    this.mediaStreamTrack.stop()
    this.sourceNode?.disconnect()
    this.noiseReducer?.disconnect()
  }

  mute(): void {
    this.mediaStreamTrack.enabled = false
  }

  unmute(): void {
    this.mediaStreamTrack.enabled = true
  }

  private getNoiseReducer(): NoiseReducer {
    if (this.noiseReducer) {
      return this.noiseReducer
    }
    return (this.noiseReducer = new NoiseReducer())
  }
}
