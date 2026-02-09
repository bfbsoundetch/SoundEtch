import { WamParameterInfo } from '@webaudiomodules/api'

export type TransitionType = 'linear' | 'logarithmic' | 'exponential' | 'scurve'

export class ParamValueTransition {
  constructor(
    public type: TransitionType,
    public startValue: number,
    public position: number,
  ) {}

  generateSCurve(length = 32) {
    const result = new Array<number>(length)
    for (let i = 1; i <= length; ++i) {
      result[i] = Math.cos((Math.PI * i) / length) / 2 + 0.5
    }
  }

  generateLogCurve(length = 32) {
    const result = new Array<number>(length)
    for (let i = 1; i <= length; ++i) {
      result[i] = Math.log10(1 + (9 * i) / length)
    }
  }

  generateExpCurve(length = 32) {
    const result = new Array<number>(length)
    for (let i = 1; i <= length; ++i) {
      result[i] = Math.exp((-5 * i) / length)
    }
  }
}

export class ParameterValueSequence {
  readonly transitionSequence = new Array<ParamValueTransition>()

  constructor(readonly param: WamParameterInfo) {}
}
