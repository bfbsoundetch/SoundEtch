export enum EffectType {
  gain,
  eq,
}

export type GainEffect = {
  type: EffectType.gain
  startPosition: number
  length: number
  value: number
}

export type EqEffect = {
  type: EffectType.eq
  startPosition: number
  length: number
  filters: Array<{
    type: string
    frequency: number
    q: number
    gain: number
    bypassed: boolean
  }>
}

export type Effect = GainEffect | EqEffect
