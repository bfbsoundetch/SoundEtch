import { CompressionEffectMetadata } from '../BuiltinEffectMetadata'
import { EffectModule } from '../Effect'

export class CompressionEffect implements EffectModule {
  readonly metadata = CompressionEffectMetadata

  private compressorNode: DynamicsCompressorNode | null = null

  async connect(audioContext: BaseAudioContext, destination: AudioNode): Promise<AudioNode> {
    const compressorNode = this.getNode(audioContext)
    compressorNode.connect(destination)
    return compressorNode
  }

  disconnect() {
    this.compressorNode?.disconnect()
  }

  private getNode(audioContext: BaseAudioContext) {
    if (audioContext != this.compressorNode?.context) {
      this.disconnect()
      this.compressorNode = audioContext.createDynamicsCompressor()
    }
    return this.compressorNode
  }

  async getParameters(audioContext: BaseAudioContext) {
    const compressorNode = this.getNode(audioContext)
    return {
      threshold: compressorNode.threshold,
      knee: compressorNode.knee,
      ratio: compressorNode.ratio,
      attack: compressorNode.attack,
      release: compressorNode.release,
    }
  }
}
