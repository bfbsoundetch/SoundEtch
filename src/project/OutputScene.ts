import type { Track } from './Track'

/** Normalized fractions of the cropped overflow: 0 is left/top, 1 is right/bottom. */
export interface CropPosition {
  x: number
  y: number
  /** Cover zoom relative to the base crop; absent values mean 1. */
  scale?: number
}

export type OutputTransitionKind = 'fade' | 'crossfade' | 'slide' | 'push' | 'zoom'
export type OutputTransitionDirection = 'left' | 'right' | 'up' | 'down'

/** How a scene replaces the previous one. It plays centered on their boundary. */
export interface OutputTransition {
  kind: OutputTransitionKind
  /** Seconds; playback shortens it to at most half of either adjacent scene. */
  duration: number
  /** The way Slide and Push move the pictures; other kinds ignore it. */
  direction: OutputTransitionDirection
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
  /** The change from the previous scene at this scene's start; absent values cut. The first scene has none. */
  transition?: OutputTransition
}

export const OUTPUT_TRANSITION_KINDS: readonly OutputTransitionKind[] = ['fade', 'crossfade', 'slide', 'push', 'zoom']
export const OUTPUT_TRANSITION_DIRECTIONS: readonly OutputTransitionDirection[] = ['left', 'right', 'up', 'down']
export const DEFAULT_OUTPUT_TRANSITION_DURATION = 0.5

export const MIN_OUTPUT_CROP_SCALE = 1
export const MAX_OUTPUT_CROP_SCALE = 4

export function clampOutputCropScale(scale: number): number {
  return Number.isNaN(scale)
    ? MIN_OUTPUT_CROP_SCALE
    : Math.max(MIN_OUTPUT_CROP_SCALE, Math.min(MAX_OUTPUT_CROP_SCALE, scale))
}

const centeredCropPosition: Readonly<CropPosition> = Object.freeze({ x: 0.5, y: 0.5 })

export function getOutputCropPosition(scene: OutputScene, slot: number): Readonly<CropPosition> {
  return scene.cropPositions?.[slot] ?? centeredCropPosition
}

export function getOutputCropScale(scene: OutputScene, slot: number): number {
  return clampOutputCropScale(getOutputCropPosition(scene, slot).scale ?? MIN_OUTPUT_CROP_SCALE)
}

/** The transition into scene `index`, or null where the scenes cut. */
export function getOutputTransition(scenes: readonly OutputScene[], index: number): Readonly<OutputTransition> | null {
  const transition = index > 0 ? scenes[index]?.transition : undefined
  return transition && OUTPUT_TRANSITION_KINDS.includes(transition.kind) ? transition : null
}

/** Copy editable scene data while retaining source track identities. */
export function cloneOutputScene(scene: OutputScene): OutputScene {
  const copy: OutputScene = { ...scene, tracks: [...scene.tracks] }
  if (scene.cropPositions) {
    copy.cropPositions = [{ ...scene.cropPositions[0] }, { ...scene.cropPositions[1] }]
  }
  if (scene.transition) copy.transition = { ...scene.transition }
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
  // The new boundary starts as a cut; the containing scene keeps the transition at its own start.
  delete inherited.transition
  result.splice(index + 1, 0, inherited)
  return result
}

/** Move an interior boundary; collapsing either adjacent scene removes only that scene and its transition. */
export function moveOutputSceneBoundary(
  scenes: readonly OutputScene[],
  index: number,
  sample: number,
  projectLength: number,
): OutputScene[] | null {
  if (
    !Number.isInteger(index) ||
    index <= 0 ||
    index >= scenes.length ||
    !Number.isSafeInteger(sample) ||
    !Number.isSafeInteger(projectLength)
  ) {
    return null
  }
  const minimum = scenes[index - 1].startSample
  const maximum = Math.min(scenes[index + 1]?.startSample ?? projectLength, projectLength)
  if (minimum >= maximum) return null
  const target = Math.max(minimum, Math.min(maximum, sample))
  if (target === scenes[index].startSample) return null
  const result = scenes.map(cloneOutputScene)
  if (target === minimum) {
    result.splice(index - 1, 1)
    result[index - 1].startSample = target
    // A scene that becomes the first one has nothing to transition from.
    if (index === 1) delete result[0].transition
  } else if (target === maximum) {
    result.splice(index, 1)
  } else {
    result[index].startSample = target
  }
  return result
}
