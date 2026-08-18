import { BoostEffectMetadata, FadeEffectMetadata } from '../BuiltinEffectMetadata'
import { EffectModule } from '../Effect'

abstract class GainEffect {
  private gainNode: GainNode | null = null

  async connect(audioContext: BaseAudioContext, destination: AudioNode): Promise<AudioNode> {
    const gainNode = this.getNode(audioContext)
    gainNode.connect(destination)
    return gainNode
  }

  disconnect() {
    this.gainNode?.disconnect()
  }

  private getNode(audioContext: BaseAudioContext) {
    if (audioContext != this.gainNode?.context) {
      this.disconnect()
      this.gainNode = audioContext.createGain()
    }
    return this.gainNode
  }

  async getParameters(audioContext: BaseAudioContext) {
    return { gain: this.getNode(audioContext).gain }
  }
}

export class FadeEffect extends GainEffect implements EffectModule {
  readonly metadata = FadeEffectMetadata
}

export class BoostEffect extends GainEffect implements EffectModule {
  readonly metadata = BoostEffectMetadata
}
