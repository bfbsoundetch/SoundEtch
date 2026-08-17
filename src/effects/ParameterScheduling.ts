import { ParameterValueSequence, ParamValueTransition } from './ParameterValueSequence'

export function scheduleParameterValues(
  parameter: AudioParam,
  sequence: ParameterValueSequence,
  audioContext: BaseAudioContext,
  startSample: number,
) {
  const transitions = [...sequence.transitionSequence].sort((a, b) => a.startSample - b.startSample)
  const elapsedTransitions = transitions.filter((transition) => transition.startSample <= startSample)
  let previousValue = elapsedTransitions.at(-1)?.startValue ?? sequence.initialValue
  let previousSample = startSample

  parameter.cancelScheduledValues(audioContext.currentTime)
  parameter.setValueAtTime(previousValue, audioContext.currentTime)

  for (const transition of transitions) {
    if (transition.startSample <= startSample) {
      continue
    }
    const time = audioContext.currentTime + (transition.startSample - startSample) / audioContext.sampleRate
    const previousTime = audioContext.currentTime + (previousSample - startSample) / audioContext.sampleRate
    scheduleTransition(parameter, transition, previousValue, previousTime, time)
    previousValue = transition.startValue
    previousSample = transition.startSample
  }
}

function scheduleTransition(
  parameter: AudioParam,
  transition: ParamValueTransition,
  previousValue: number,
  previousTime: number,
  time: number,
) {
  if (transition.type == 'linear') {
    parameter.linearRampToValueAtTime(transition.startValue, time)
    return
  }
  if (transition.type == 'exponential' && previousValue > 0 && transition.startValue > 0) {
    parameter.exponentialRampToValueAtTime(transition.startValue, time)
    return
  }

  const duration = time - previousTime
  if (duration <= 0) {
    parameter.setValueAtTime(transition.startValue, time)
    return
  }
  const normalizedCurve =
    transition.type == 'scurve'
      ? ParamValueTransition.generateSCurve()
      : transition.type == 'logarithmic'
        ? ParamValueTransition.generateLogCurve()
        : ParamValueTransition.generateExpCurve()
  const curve = Float32Array.from(
    normalizedCurve,
    (value) => previousValue + value * (transition.startValue - previousValue),
  )
  parameter.setValueCurveAtTime(curve, previousTime, duration)
}
