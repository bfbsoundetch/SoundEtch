import type { Track } from './Track'

export interface OutputScene {
  startSample: number
  layout: 'single' | 'side-by-side'
  fit: 'contain' | 'cover'
  tracks: [Track | null, Track | null]
}

/** Scenes are ordered by start sample; a boundary belongs to the scene on its right. */
export function getOutputSceneIndex(scenes: readonly OutputScene[], sample: number): number {
  let low = 0
  let high = scenes.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (scenes[middle].startSample <= sample) {
      low = middle + 1
    } else {
      high = middle
    }
  }
  return low - 1
}

export function splitOutputScene(
  scenes: readonly OutputScene[],
  sample: number,
  projectLength: number,
): OutputScene[] | null {
  if (!Number.isSafeInteger(sample) || sample <= 0 || sample >= projectLength) {
    return null
  }
  const index = getOutputSceneIndex(scenes, sample)
  if (index < 0 || scenes[index].startSample === sample) {
    return null
  }
  const result = scenes.map((scene): OutputScene => ({ ...scene, tracks: [...scene.tracks] }))
  const inherited = result[index]
  result.splice(index + 1, 0, { ...inherited, startSample: sample, tracks: [...inherited.tracks] })
  return result
}
