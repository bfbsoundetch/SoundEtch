import { BoostEffectMetadata, FadeEffectMetadata } from '../BuiltinEffectMetadata'
import { EffectModule } from '../Effect'

abstract class GainEffect {
  private gainNode: GainNode | null = null

  async getNode(audioContext: BaseAudioContext): Promise<AudioNode> {
    if (audioContext != this.gainNode?.context) {
      this.gainNode = audioContext.createGain()
    }
    return this.gainNode
  }

  async getParameters(audioContext: BaseAudioContext) {
    await this.getNode(audioContext)
    return { gain: this.gainNode!.gain }
  }
}

export class FadeEffect extends GainEffect implements EffectModule {
  readonly metadata = FadeEffectMetadata
}

export class BoostEffect extends GainEffect implements EffectModule {
  readonly metadata = BoostEffectMetadata
}
