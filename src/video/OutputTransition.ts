import {
  getOutputSceneIndex,
  getOutputTransition,
  type OutputScene,
  type OutputTransition,
  type OutputTransitionDirection,
  type OutputTransitionKind,
} from '../project/OutputScene'

export const OUTPUT_TRANSITION_LABELS: Record<OutputTransitionKind, string> = {
  fade: 'Fade through black',
  crossfade: 'Crossfade',
  slide: 'Slide',
  push: 'Push',
  zoom: 'Zoom',
}

/** One scene's composed 16:9 picture, moved and faded by a transition. */
export interface OutputSceneLayer {
  /** Position in the scene list. */
  readonly index: number
  /** Group opacity, including the scene's black background, over the layers below and a black frame. */
  readonly opacity: number
  /** Offset in frame widths and heights; positive values move right and down. */
  readonly x: number
  readonly y: number
  /** Size relative to the frame, around its center. */
  readonly scale: number
}

export interface OutputTransitionWindow {
  readonly start: number
  readonly end: number
}

/** Zoom grows the outgoing picture by this fraction while the incoming one grows into place from this much smaller. */
const ZOOM = 0.25

const DIRECTIONS: Record<OutputTransitionDirection, readonly [number, number]> = {
  left: [-1, 0],
  right: [1, 0],
  up: [0, -1],
  down: [0, 1],
}

/**
 * Project samples in which scene `index` replaces the previous one. The window is centered on the boundary and takes at
 * most half of either adjacent scene, so consecutive transitions never overlap. Null where the scenes cut.
 */
export function getOutputTransitionWindow(
  scenes: readonly OutputScene[],
  index: number,
  sampleRate: number,
  projectLength: number,
): OutputTransitionWindow | null {
  const transition = getOutputTransition(scenes, index)
  if (!transition) return null
  const boundary = scenes[index].startSample
  const half = Math.min(
    (transition.duration * sampleRate) / 2,
    (boundary - scenes[index - 1].startSample) / 2,
    ((scenes[index + 1]?.startSample ?? projectLength) - boundary) / 2,
  )
  // Also rejects NaN durations, rates, and lengths.
  return half > 0 ? { start: boundary - half, end: boundary + half } : null
}

/** The scenes visible at `sample` in paint order: one, two during a transition, or none before the first scene. */
export function getOutputSceneLayers(
  scenes: readonly OutputScene[],
  sample: number,
  sampleRate: number,
  projectLength: number,
): OutputSceneLayer[] {
  const index = getOutputSceneIndex(scenes, sample)
  if (index < 0) return []
  // A boundary belongs to the scene on its right: `sample` can be late in the transition into this scene or early in
  // the one into the next scene.
  for (const incoming of [index, index + 1]) {
    const window = getOutputTransitionWindow(scenes, incoming, sampleRate, projectLength)
    if (window && sample >= window.start && sample < window.end) {
      const progress = (sample - window.start) / (window.end - window.start)
      return getTransitionLayers(incoming, getOutputTransition(scenes, incoming)!, progress)
    }
  }
  return [{ index, opacity: 1, x: 0, y: 0, scale: 1 }]
}

function getTransitionLayers(
  incoming: number,
  transition: Readonly<OutputTransition>,
  progress: number,
): OutputSceneLayer[] {
  const outgoing = incoming - 1
  // Motion eases in and out (cubic); fades stay linear.
  const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - (2 - 2 * progress) ** 3 / 2
  switch (transition.kind) {
    case 'fade':
      // Out to black, then in from black: the boundary itself is black.
      return [
        { index: outgoing, opacity: Math.max(0, 1 - 2 * progress), x: 0, y: 0, scale: 1 },
        { index: incoming, opacity: Math.max(0, 2 * progress - 1), x: 0, y: 0, scale: 1 },
      ]
    case 'crossfade':
      return [
        { index: outgoing, opacity: 1, x: 0, y: 0, scale: 1 },
        { index: incoming, opacity: progress, x: 0, y: 0, scale: 1 },
      ]
    case 'zoom':
      return [
        { index: outgoing, opacity: 1, x: 0, y: 0, scale: 1 + ZOOM * eased },
        { index: incoming, opacity: progress, x: 0, y: 0, scale: 1 - ZOOM * (1 - eased) },
      ]
    case 'slide':
    case 'push': {
      // The incoming picture enters from the opposite edge; Push moves the outgoing one out ahead of it.
      const [dx, dy] = DIRECTIONS[transition.direction] ?? DIRECTIONS.left
      const pushed = transition.kind === 'push' ? eased : 0
      return [
        { index: outgoing, opacity: 1, x: dx * pushed, y: dy * pushed, scale: 1 },
        { index: incoming, opacity: 1, x: dx * (eased - 1), y: dy * (eased - 1), scale: 1 },
      ]
    }
  }
}
