export type Effect = Amplify | Fade | Biquad | Compressor | Delay

export type Amplify = {
  effect: 'amplify'
  startSample: number
  length: number
  value: number
}

export type Fade = {
  effect: 'fade'
  startSample: number
  length: number
  shape: 'linear' | 'logarithmic' | 'exponential' | 'scurve'
  direction: 'in' | 'out'
}

export type Biquad = {
  effect: 'biquad'
  startSample: number
  length: number
  type: BiquadFilterType
  frequency: number
  q: number
  gain: number
  detune: number
}

export type Compressor = {
  effect: 'compressor'
  startSample: number
  length: number
  threshold: number
  knee: number
  ratio: number
  attack: number
  release: number
}

export type Delay = {
  effect: 'delay'
  delayTime: number
  startSample: number
  length: number
}

export function generateEffectsChain(
  audioContext: AudioContext,
  firstEffect: Effect,
  ...effects: Array<Effect>
): { firstNode: AudioNode; lastNode: AudioNode } {
  const first = effectToNode(audioContext, firstEffect)
  let last = first
  for (const effect of effects) {
    const node = effectToNode(audioContext, effect)
    last.connect(node)
    last = node
  }
  return { firstNode: first, lastNode: last }
}

function effectToNode(audioContext: AudioContext, effect: Effect): AudioNode {
  switch (effect.effect) {
    case 'amplify':
      const amplifyNode = audioContext.createGain()
      amplifyNode.gain
        .setValueAtTime(effect.value, effect.startSample / audioContext.sampleRate)
        .setValueAtTime(1, effect.startSample + effect.length / audioContext.sampleRate)
      return amplifyNode
    case 'fade':
      const fadeNode = audioContext.createGain()
      const startValue = effect.direction === 'in' ? 0 : 1
      const endValue = 1 - startValue
      fadeNode.gain
        .setValueAtTime(startValue, 0)
        .setValueCurveAtTime(
          [startValue, endValue],
          effect.startSample / audioContext.sampleRate,
          effect.length / audioContext.sampleRate,
        )
      return fadeNode
    case 'biquad':
      const biquadNode = audioContext.createBiquadFilter()
      biquadNode.Q.value = effect.q
      biquadNode.gain
        .setValueAtTime(1, effect.startSample / audioContext.sampleRate)
        .setValueAtTime(0, (effect.startSample + effect.length) / audioContext.sampleRate)
      biquadNode.frequency.value = effect.frequency
      biquadNode.detune.value = effect.detune
      return biquadNode
    case 'compressor':
      const compressor = audioContext.createDynamicsCompressor()
      compressor.attack.value = effect.attack
      compressor.knee.value = effect.knee
      compressor.release.value = effect.release
      compressor.threshold
        .setValueAtTime(0, 0)
        .setValueAtTime(effect.threshold, effect.startSample / audioContext.sampleRate)
        .setValueAtTime((effect.startSample + effect.length) / audioContext.sampleRate, 0)
      compressor.ratio.value = effect.ratio
      return compressor
    case 'delay':
      const delay = audioContext.createDelay(effect.delayTime)
      delay.delayTime
        .setValueAtTime(0, 0)
        .setValueAtTime(effect.delayTime, effect.startSample / audioContext.sampleRate)
        .setValueAtTime(0, (effect.startSample + effect.length) / audioContext.sampleRate)
      return delay
  }
}
