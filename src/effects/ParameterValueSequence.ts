export type TransitionType = 'linear' | 'logarithmic' | 'exponential' | 'scurve'

export class ParamValueTransition {
  constructor(
    public type: TransitionType,
    public startValue: number,
    public startSample: number,
  ) {}

  static generateSCurve(length = 32) {
    const result = new Array<number>(length)
    for (let i = 0; i < length; ++i) {
      result[i] = (1 - Math.cos((Math.PI * i) / (length - 1))) / 2
    }
    return result
  }

  static generateLogCurve(length = 32) {
    const result = new Array<number>(length)
    for (let i = 0; i < length; ++i) {
      result[i] = Math.log10(1 + (9 * i) / (length - 1))
    }
    return result
  }

  static generateExpCurve(length = 32) {
    const result = new Array<number>(length)
    for (let i = 0; i < length; ++i) {
      result[i] = 10 ** (-3 * i / length)
    }
    return result.reverse()
  }
}

export class ParameterValueSequence {
  constructor(public initialValue: number) {}

  readonly transitionSequence = new Array<ParamValueTransition>()
}
