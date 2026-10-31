import type { Track } from './Track'

/** Normalized fractions of the cropped overflow: 0 is left/top, 1 is right/bottom. */
export interface CropPosition {
  x: number
  y: number
}

export interface OutputScene {
  startSample: number
  layout: 'single' | 'side-by-side'
  fit: 'contain' | 'cover'
  tracks: [Track | null, Track | null]
  cropPositions?: [CropPosition, CropPosition]
  /** Frame styling in pixels on the 1920×1080 output canvas; absent values are zero. */
  cornerRadius?: number
  margin?: number
}

const centeredCropPosition: Readonly<CropPosition> = Object.freeze({ x: 0.5, y: 0.5 })

export function getOutputCropPosition(scene: OutputScene, slot: number): Readonly<CropPosition> {
  return scene.cropPositions?.[slot] ?? centeredCropPosition
}

/** Copy editable scene data while retaining source track identities. */
export function cloneOutputScene(scene: OutputScene): OutputScene {
  const copy: OutputScene = { ...scene, tracks: [...scene.tracks] }
  if (scene.cropPositions) {
    copy.cropPositions = [{ ...scene.cropPositions[0] }, { ...scene.cropPositions[1] }]
  }
  return copy
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
  const result = scenes.map(cloneOutputScene)
  const inherited = cloneOutputScene(result[index])
  inherited.startSample = sample
  result.splice(index + 1, 0, inherited)
  return result
}
