import { GainEffectMetadata } from './BuiltinEffectMetadata'
import { EffectIndex } from './EffectIndex'
import { ParameterValueSequence, ParamValueTransition } from './ParameterValueSequence'

describe('EffectIndex', () => {
  test('lists and creates the built-in gain effect', async () => {
    const effectIndex = EffectIndex.getInstance()

    expect(effectIndex.getAvailableEffects()).toContain(GainEffectMetadata)
    expect(effectIndex.getEffectMetadataById(GainEffectMetadata.id)).toBe(GainEffectMetadata)
    expect((await effectIndex.getEffectById(GainEffectMetadata.id))?.metadata).toBe(GainEffectMetadata)
  })

  test('returns null for an unknown effect', async () => {
    const effectIndex = EffectIndex.getInstance()

    expect(effectIndex.getEffectMetadataById('unknown')).toBeNull()
    await expect(effectIndex.getEffectById('unknown')).resolves.toBeNull()
  })
})

describe('effect parameters', () => {
  test('stores a static value separately from automation points', () => {
    const sequence = new ParameterValueSequence(1)
    sequence.transitionSequence.push(new ParamValueTransition('linear', 2, 100))

    expect(sequence.initialValue).toBe(1)
    expect(sequence.transitionSequence).toEqual([{ type: 'linear', startValue: 2, startSample: 100 }])
  })

  test('gain normalization spans its complete metadata range', () => {
    const gain = GainEffectMetadata.parameters[0]

    expect(gain.normalize(gain.minValue)).toBeCloseTo(0)
    expect(gain.normalize(gain.maxValue)).toBeCloseTo(1)
    expect(gain.denormalize(gain.normalize(gain.defaultValue))).toBeCloseTo(gain.defaultValue)
    expect(gain.displayValue(gain.defaultValue)).toBe('100%')
  })

  test.each(
    [
      ParamValueTransition.generateSCurve(),
      ParamValueTransition.generateLogCurve(),
      ParamValueTransition.generateExpCurve(),
    ].map((curve) => [curve]),
  )('generated automation curve includes both endpoints', (curve) => {
    expect(curve).toHaveLength(32)
    expect(curve[0]).toBeCloseTo(0)
    expect(curve.at(-1)).toBeCloseTo(1)
  })
})
