import { BoostEffectMetadata, CompressionEffectMetadata, NoiseReductionEffectMetadata } from './BuiltinEffectMetadata'
import { EffectIndex } from './EffectIndex'
import { ParameterValueSequence, ParamValueTransition } from './ParameterValueSequence'
import { BoostEffect } from './gain/GainEffects'

describe('EffectIndex', () => {
  test('lists and creates built-in effects', async () => {
    const effectIndex = EffectIndex.getInstance()

    expect(effectIndex.getAvailableEffects()).toContain(BoostEffectMetadata)
    expect(effectIndex.getAvailableEffects()).toContain(NoiseReductionEffectMetadata)
    expect(effectIndex.getAvailableEffects()).toContain(CompressionEffectMetadata)
    expect(effectIndex.getEffectMetadataById(BoostEffectMetadata.id)).toBe(BoostEffectMetadata)
    expect((await effectIndex.getEffectById(BoostEffectMetadata.id))?.metadata).toBe(BoostEffectMetadata)
    expect((await effectIndex.getEffectById(CompressionEffectMetadata.id))?.metadata).toBe(CompressionEffectMetadata)
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
    const gain = BoostEffectMetadata.parameters[0]

    expect(gain.normalize(gain.minValue)).toBeCloseTo(0)
    expect(gain.normalize(gain.maxValue)).toBeCloseTo(1)
    expect(gain.denormalize(gain.normalize(gain.defaultValue))).toBeCloseTo(gain.defaultValue)
    expect(gain.displayValue(gain.defaultValue)).toBe('1.00x')
    expect(gain.scaleValues).toEqual([1, 2, 4, 8, 16, 32, 64])
  })

  test.each(CompressionEffectMetadata.parameters)(
    '$displayName normalization spans its metadata range',
    (parameter) => {
      expect(parameter.normalize(parameter.minValue)).toBeCloseTo(0)
      expect(parameter.normalize(parameter.maxValue)).toBeCloseTo(1)
      expect(parameter.denormalize(parameter.normalize(parameter.defaultValue))).toBeCloseTo(parameter.defaultValue)
    },
  )

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

describe('effect module connections', () => {
  test('connects its output, returns its input, and disconnects explicitly', async () => {
    const gainNode = {
      context: null as unknown as BaseAudioContext,
      gain: {},
      connect: jest.fn(),
      disconnect: jest.fn(),
    }
    const audioContext = {
      createGain: jest.fn(() => gainNode),
    } as unknown as BaseAudioContext
    gainNode.context = audioContext
    const destination = {} as AudioNode
    const effect = new BoostEffect()

    const input = await effect.connect(audioContext, destination)
    const parameters = await effect.getParameters(audioContext)
    effect.disconnect()

    expect(input).toBe(gainNode)
    expect(gainNode.connect).toHaveBeenCalledWith(destination)
    expect(parameters.gain).toBe(gainNode.gain)
    expect(audioContext.createGain).toHaveBeenCalledTimes(1)
    expect(gainNode.disconnect).toHaveBeenCalledTimes(1)
  })
})
