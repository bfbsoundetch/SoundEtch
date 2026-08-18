import { CompressionEffectMetadata } from '../BuiltinEffectMetadata'
import { EffectModule } from '../Effect'

export class CompressionEffect implements EffectModule {
  readonly metadata = CompressionEffectMetadata

  private compressorNode: DynamicsCompressorNode | null = null

  async getNode(audioContext: BaseAudioContext): Promise<AudioNode> {
    if (audioContext != this.compressorNode?.context) {
      this.compressorNode = audioContext.createDynamicsCompressor()
    }
    return this.compressorNode
  }

  async getParameters(audioContext: BaseAudioContext) {
    await this.getNode(audioContext)
    return {
      threshold: this.compressorNode!.threshold,
      knee: this.compressorNode!.knee,
      ratio: this.compressorNode!.ratio,
      attack: this.compressorNode!.attack,
      release: this.compressorNode!.release,
    }
  }
}
