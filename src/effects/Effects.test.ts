import {
  BoostEffectMetadata,
  CompressionEffectMetadata,
  DeesserEffectMetadata,
  GateEffectMetadata,
  LimiterEffectMetadata,
  NoiseReductionEffectMetadata,
} from './BuiltinEffectMetadata'
import { EffectIndex } from './EffectIndex'
import { ParameterValueSequence, ParamValueTransition } from './ParameterValueSequence'
import { BoostEffect } from './gain/GainEffects'
import { EqualizerEffectMetadata } from './equalizer/EqualizerMetadata'
import { EqualizerEffect } from './equalizer/EqualizerEffect'
import { RawDataAudioContext } from '@descript/web-audio-js'

describe('EffectIndex', () => {
  test('lists and creates built-in effects', async () => {
    const effectIndex = EffectIndex.getInstance()

    expect(effectIndex.getAvailableEffects()).toContain(BoostEffectMetadata)
    expect(effectIndex.getAvailableEffects()).toContain(NoiseReductionEffectMetadata)
    expect(effectIndex.getAvailableEffects()).toContain(CompressionEffectMetadata)
    expect(effectIndex.getAvailableEffects()).toContain(DeesserEffectMetadata)
    expect(effectIndex.getAvailableEffects()).toContain(LimiterEffectMetadata)
    expect(effectIndex.getAvailableEffects()).toContain(GateEffectMetadata)
    expect(effectIndex.getAvailableEffects()).toContain(EqualizerEffectMetadata)
    expect(effectIndex.getEffectMetadataById(BoostEffectMetadata.id)).toBe(BoostEffectMetadata)
    expect((await effectIndex.getEffectById(BoostEffectMetadata.id))?.metadata).toBe(BoostEffectMetadata)
    expect((await effectIndex.getEffectById(CompressionEffectMetadata.id))?.metadata).toBe(CompressionEffectMetadata)
  })

  test('creates the equalizer effect', async () => {
    expect((await EffectIndex.getInstance().getEffectById(EqualizerEffectMetadata.id))?.metadata).toBe(
      EqualizerEffectMetadata,
    )
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

  test.each(DeesserEffectMetadata.parameters)('$displayName normalization spans its metadata range', (parameter) => {
    expect(parameter.normalize(parameter.minValue)).toBeCloseTo(0)
    expect(parameter.normalize(parameter.maxValue)).toBeCloseTo(1)
    expect(parameter.denormalize(parameter.normalize(parameter.defaultValue))).toBeCloseTo(parameter.defaultValue)
  })

  test.each(LimiterEffectMetadata.parameters)('$displayName normalization spans its metadata range', (parameter) => {
    expect(parameter.normalize(parameter.minValue)).toBeCloseTo(0)
    expect(parameter.normalize(parameter.maxValue)).toBeCloseTo(1)
    expect(parameter.denormalize(parameter.normalize(parameter.defaultValue))).toBeCloseTo(parameter.defaultValue)
  })

  test.each(GateEffectMetadata.parameters)('$displayName normalization spans its metadata range', (parameter) => {
    expect(parameter.normalize(parameter.minValue)).toBeCloseTo(0)
    expect(parameter.normalize(parameter.maxValue)).toBeCloseTo(1)
    expect(parameter.denormalize(parameter.normalize(parameter.defaultValue))).toBeCloseTo(parameter.defaultValue)
  })

  test.each(EqualizerEffectMetadata.parameters)('$displayName normalization spans its metadata range', (parameter) => {
    expect(parameter.normalize(parameter.minValue)).toBeCloseTo(0)
    expect(parameter.normalize(parameter.maxValue)).toBeCloseTo(1)
    expect(parameter.denormalize(parameter.normalize(parameter.defaultValue))).toBeCloseTo(parameter.defaultValue)
  })

  test('equalizer default state is cloned for each effect instance', () => {
    const first = EqualizerEffectMetadata.createDefaultState?.() as Array<{ frequency: number }>
    const second = EqualizerEffectMetadata.createDefaultState?.() as Array<{ frequency: number }>

    first[0].frequency = 1234

    expect(second[0].frequency).not.toBe(1234)
  })

  test('noise reduction default state is cloned for each effect instance', () => {
    const first = NoiseReductionEffectMetadata.createDefaultState?.() as { attenuationLimit: number }
    const second = NoiseReductionEffectMetadata.createDefaultState?.() as { attenuationLimit: number }

    first.attenuationLimit = 10

    expect(second.attenuationLimit).toBe(100)
    expect(NoiseReductionEffectMetadata.parameters).toEqual([])
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

  test('equalizer exposes stable parameters while its filter graph changes', async () => {
    const audioContext = new RawDataAudioContext({ sampleRate: 48000, blockSize: 128, numberOfChannels: 2 })
    const context = audioContext as unknown as BaseAudioContext
    const effect = new EqualizerEffect()
    const firstParameters = await effect.getParameters(context)
    const state = EqualizerEffectMetadata.createDefaultState?.() as Array<{
      type: string
      frequency: number
      gain: number
      Q: number
      bypass: boolean
    }>

    firstParameters['band1.frequency'].value = 4321
    state[0].frequency = 1234
    state[0].type = 'noop'
    state[1].bypass = true
    effect.setState(state)
    const secondParameters = await effect.getParameters(context)
    const destination = audioContext.createGain()
    const input = await effect.connect(context, destination as unknown as AudioNode)

    expect(Object.keys(firstParameters)).toHaveLength(24)
    expect(secondParameters['band1.frequency']).toBe(firstParameters['band1.frequency'])
    expect(secondParameters['band1.frequency'].value).toBe(4321)
    expect(secondParameters['band8.q']).toBe(firstParameters['band8.q'])
    expect(input.context).toBe(context)
    effect.disconnect()
  })
})
