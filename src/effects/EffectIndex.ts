import {
  FadeEffectMetadata,
  BoostEffectMetadata,
  NoiseReductionEffectMetadata,
  CompressionEffectMetadata,
} from './BuiltinEffectMetadata'
import { EffectMetadata, EffectModule } from './Effect'

export class EffectIndex {
  private static instance: EffectIndex | null = null
  private readonly availableEffects: readonly EffectMetadata[] = [
    FadeEffectMetadata,
    BoostEffectMetadata,
    NoiseReductionEffectMetadata,
    CompressionEffectMetadata,
  ]

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
      case NoiseReductionEffectMetadata.id:
        return new (await import('./noisereduction/NoiseReductionEffect')).NoiseReductionEffect()
      case CompressionEffectMetadata.id:
        return new (await import('./compression/CompressionEffect')).CompressionEffect()
      default:
        return null
    }
  }
}
