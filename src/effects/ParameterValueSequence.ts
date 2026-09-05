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
    return this.generateExpCurve(length)
      .map((n) => 1 - n)
      .reverse()
  }

  static generateExpCurve(length = 32) {
    const result = new Array<number>(length)
    for (let i = 0; i < length; ++i) {
      result[i] = 30 ** ((-2 * i) / length)
    }
    return result.reverse()
  }
}

export class ParameterValueSequence {
  constructor(public initialValue: number) {}

  readonly transitionSequence = new Array<ParamValueTransition>()
}
