import { DEFAULT_SPEC } from '@bfbsoundetch/weq8'
import { EffectMetadata } from '../Effect'
import { ParameterMetadata } from '../ParameterMetadata'

export type EqualizerParameter = 'frequency' | 'gain' | 'Q'

export function getEqualizerParameterId(band: number, parameter: EqualizerParameter) {
  return `band${band + 1}.${parameter.toLowerCase()}`
}

const createBandParameters = (band: number): ParameterMetadata[] => {
  const defaults = DEFAULT_SPEC[band]
  return [
    {
      id: getEqualizerParameterId(band, 'frequency'),
      displayName: `Band ${band + 1} Frequency`,
      defaultValue: defaults.frequency,
      minValue: 10,
      maxValue: 24000,
      increment: 0.1,
      normalize: (value) => Math.log10(value / 10) / Math.log10(2400),
      denormalize: (value) => 10 * 2400 ** value,
      displayValue: (value) => (value >= 1000 ? `${(value / 1000).toFixed(2)} kHz` : `${value.toFixed(0)} Hz`),
      scaleValues: [10, 100, 1000, 10000, 24000],
    },
    {
      id: getEqualizerParameterId(band, 'gain'),
      displayName: `Band ${band + 1} Gain`,
      defaultValue: defaults.gain,
      minValue: -15,
      maxValue: 15,
      increment: 0.1,
      normalize: (value) => (value + 15) / 30,
      denormalize: (value) => value * 30 - 15,
      displayValue: (value) => `${value.toFixed(1)} dB`,
      scaleValues: [-15, -12, -6, 0, 6, 12, 15],
    },
    {
      id: getEqualizerParameterId(band, 'Q'),
      displayName: `Band ${band + 1} Q`,
      defaultValue: defaults.Q,
      minValue: 0.1,
      maxValue: 18,
      increment: 0.1,
      normalize: (value) => Math.log(value / 0.1) / Math.log(180),
      denormalize: (value) => 0.1 * 180 ** value,
      displayValue: (value) => value.toFixed(2),
      scaleValues: [0.1, 0.3, 1, 3, 10, 18],
    },
  ]
}

export const EqualizerEffectMetadata: EffectMetadata = {
  id: 'soundetch.equalizer',
  name: 'Equalizer',
  description: 'Shape the frequency spectrum with up to eight parametric filters',
  categories: ['Equalization'],
  parameters: Array.from({ length: 8 }, (_, band) => createBandParameters(band)).flat(),
  createDefaultState: () => structuredClone(DEFAULT_SPEC),
}
