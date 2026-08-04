import { GainEffectMetadata } from './BuiltinEffectMetadata'
import { EffectMetadata, EffectModule } from './Effect'

export class EffectIndex {
  private static instance: EffectIndex | null = null
  private readonly availableEffects: readonly EffectMetadata[] = [GainEffectMetadata]

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
      case GainEffectMetadata.id:
        return new (await import('./gain/GainEffect')).GainEffect()
      default:
        return null
    }
  }
}
