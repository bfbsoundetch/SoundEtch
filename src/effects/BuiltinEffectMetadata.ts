import { EffectMetadata } from './Effect'

export const FadeEffectMetadata: EffectMetadata = {
  id: 'soundetch.fade',
  name: 'Fade',
  description: 'Decrease volume',
  categories: ['Utility'],
  parameters: [
    {
      id: 'gain',
      displayName: 'Volume',
      defaultValue: 1,
      minValue: 0,
      maxValue: 1,
      increment: 0.01,
      normalize: (gain) => gain,
      denormalize: (value) => value,
      displayValue: (gain) => `${(gain * 100).toFixed(0)}%`,
      scaleValues: [0, .5, 1],
    },
  ],
}

export const BoostEffectMetadata: EffectMetadata = {
  id: 'soundetch.boost',
  name: 'Boost',
  description: 'Increase volume',
  categories: ['Utility'],
  parameters: [
    {
      id: 'gain',
      displayName: 'Volume',
      defaultValue: 1,
      minValue: 1,
      maxValue: 64,
      increment: 0.01,
      normalize: (gain) => Math.log2(gain) / 6,
      denormalize: (value) => 2 ** (value * 6),
      displayValue: (gain) => `${(gain).toFixed(2)}x`,
      scaleValues: [0, 1, 2, 4, 8, 16, 32, 64],
    },
  ],
}