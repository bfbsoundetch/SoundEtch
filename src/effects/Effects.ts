export type GainEffect = {
  id: string
  effect: 'gain'
  startSample: number
  length: number
  value: number
}

export type Effect = GainEffect
export type EffectType = Effect['effect']

type AutomatedAudioParam = {
  value: number
  cancelScheduledValues(startTime: number): AutomatedAudioParam
  setValueAtTime(value: number, startTime: number): AutomatedAudioParam
}

export function createEffectId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function getEffectEndSample(effect: Pick<Effect, 'startSample' | 'length'>) {
  return effect.startSample + effect.length
}

export function dbToGain(valueDb: number) {
  return 10 ** (valueDb / 20)
}

export function sortEffects(effects: Effect[]) {
  return effects.slice().sort((a, b) => a.startSample - b.startSample || getEffectEndSample(a) - getEffectEndSample(b))
}

export function getGainEffectAtSample(effects: Effect[], sample: number): GainEffect | null {
  for (const effect of effects) {
    if (effect.effect !== 'gain') {
      continue
    }
    if (sample >= effect.startSample && sample < getEffectEndSample(effect)) {
      return effect
    }
  }
  return null
}

export function replaceEffectRegion(effects: Effect[], nextEffect: Effect): Effect[] {
  const nextStart = nextEffect.startSample
  const nextEnd = getEffectEndSample(nextEffect)
  const updatedEffects = new Array<Effect>()
  for (const effect of effects) {
    if (effect.id === nextEffect.id) {
      continue
    }
    if (effect.effect !== nextEffect.effect) {
      updatedEffects.push(effect)
      continue
    }
    const effectEnd = getEffectEndSample(effect)
    if (effectEnd <= nextStart || effect.startSample >= nextEnd) {
      updatedEffects.push(effect)
      continue
    }
    if (effect.startSample < nextStart) {
      updatedEffects.push({
        ...effect,
        length: nextStart - effect.startSample,
      })
    }
    if (effectEnd > nextEnd) {
      updatedEffects.push({
        ...effect,
        startSample: nextEnd,
        length: effectEnd - nextEnd,
      })
    }
  }
  updatedEffects.push(nextEffect)
  return sortEffects(updatedEffects)
}

export function scheduleGainAutomation(
  param: AutomatedAudioParam,
  effects: Effect[],
  sampleRate: number,
  playbackStartSample: number,
  playbackEndSample: number,
  playbackStartTime: number,
  resetAutomation = true,
) {
  if (resetAutomation) {
    param.cancelScheduledValues(playbackStartTime)
  }
  const initialEffect = getGainEffectAtSample(effects, playbackStartSample)
  param.setValueAtTime(initialEffect ? dbToGain(initialEffect.value) : 1, playbackStartTime)
  for (const effect of effects) {
    const effectStart = Math.max(effect.startSample, playbackStartSample)
    const effectEnd = Math.min(getEffectEndSample(effect), playbackEndSample)
    if (effectEnd <= playbackStartSample || effectStart >= playbackEndSample) {
      continue
    }
    const startTime = playbackStartTime + (effectStart - playbackStartSample) / sampleRate
    const endTime = playbackStartTime + (effectEnd - playbackStartSample) / sampleRate
    if (effectStart > playbackStartSample) {
      param.setValueAtTime(dbToGain(effect.value), startTime)
    }
    param.setValueAtTime(1, endTime)
  }
  param.setValueAtTime(1, playbackStartTime + (playbackEndSample - playbackStartSample) / sampleRate)
}
