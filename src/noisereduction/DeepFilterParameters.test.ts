import { defaultDeepFilterParameters, readDeepFilterParameters } from './DeepFilterParameters'

describe('DeepFilter parameters', () => {
  test('uses defaults for missing and invalid persisted state', () => {
    expect(readDeepFilterParameters(undefined)).toEqual(defaultDeepFilterParameters)
    expect(
      readDeepFilterParameters({
        attenuationLimit: Number.NaN,
        minDbThreshold: 'invalid',
        maxDbErbThreshold: null,
        maxDbDfThreshold: Infinity,
        postFilterBeta: {},
      }),
    ).toEqual(defaultDeepFilterParameters)
  })

  test('clamps persisted values to the supported UI ranges', () => {
    expect(
      readDeepFilterParameters({
        attenuationLimit: 200,
        minDbThreshold: -50,
        maxDbErbThreshold: -1,
        maxDbDfThreshold: 101,
        postFilterBeta: 0.1,
      }),
    ).toEqual({
      attenuationLimit: 100,
      minDbThreshold: -30,
      maxDbErbThreshold: 0,
      maxDbDfThreshold: 100,
      postFilterBeta: 0.05,
    })
  })
})
