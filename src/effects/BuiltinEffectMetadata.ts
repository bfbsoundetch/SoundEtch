import { EffectMetadata } from './Effect'

export const GainEffectMetadata: EffectMetadata = {
  id: 'soundetch.gain',
  name: 'Volume',
  description: 'Adjust volume',
  categories: ['Utility'],
  parameters: [
    {
      id: 'gain',
      displayName: 'Volume',
      defaultValue: 1,
      minValue: 0,
      maxValue: 64,
      increment: 0.01,
      normalize: (gain) => Math.log2(gain + 1) / Math.log2(65),
      denormalize: (value) => 2 ** (value * Math.log2(65)) - 1,
      displayValue: (gain) => `${(gain * 100).toFixed(0)}%`,
    },
  ],
}
