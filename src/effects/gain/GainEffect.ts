import { GainEffectMetadata } from '../BuiltinEffectMetadata'
import { EffectModule } from '../Effect'

export class GainEffect implements EffectModule {
  private gainNode: GainNode | null = null
  readonly metadata = GainEffectMetadata

  async getNode(audioContext: BaseAudioContext): Promise<AudioNode> {
    if (audioContext != this.gainNode?.context) {
      this.gainNode = new GainNode(audioContext)
    }
    return this.gainNode
  }

  async getParameters(audioContext: BaseAudioContext) {
    await this.getNode(audioContext)
    return { gain: this.gainNode!.gain }
  }
}
