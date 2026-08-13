import { FadeEffectMetadata, BoostEffectMetadata } from './BuiltinEffectMetadata'
import { EffectMetadata, EffectModule } from './Effect'

export class EffectIndex {
  private static instance: EffectIndex | null = null
  private readonly availableEffects: readonly EffectMetadata[] = [FadeEffectMetadata, BoostEffectMetadata]

  static getInstance() {
    return this.instance ?? (this.instance = new EffectIndex())
  }

  private constructor() {}

  getAvailableEffects() {
    return this.availableEffects
  }

  getEffectMetadataById(id: string) {
    return this.availableEffects.find((effect) => effect.id == id) ?? null
  }

  async getEffectById(id: string): Promise<EffectModule | null> {
    switch (id) {
      case FadeEffectMetadata.id:
        return new (await import('./gain/GainEffects')).FadeEffect()
      case BoostEffectMetadata.id:
        return new (await import('./gain/GainEffects')).BoostEffect()
      default:
        return null
    }
  }
}
