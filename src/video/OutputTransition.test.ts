import { expect, test } from 'vitest'
import type { OutputScene, OutputTransition } from '../project/OutputScene'
import { getOutputSceneLayers, getOutputTransitionWindow, type OutputSceneLayer } from './OutputTransition'

// One sample per millisecond keeps the expected positions readable.
const RATE = 1000

function createScenes(starts: number[], transitions: Record<number, Partial<OutputTransition>> = {}): OutputScene[] {
  return starts.map((startSample, index) => {
    const scene: OutputScene = { startSample, layout: 'single', fit: 'contain', tracks: [null, null] }
    const transition = transitions[index]
    if (transition) scene.transition = { kind: 'crossfade', duration: 0.5, direction: 'left', ...transition }
    return scene
  })
}

function layersAt(scenes: readonly OutputScene[], sample: number, projectLength = 10_000): OutputSceneLayer[] {
  return getOutputSceneLayers(scenes, sample, RATE, projectLength)
}

function expectLayer(layer: OutputSceneLayer, expected: OutputSceneLayer): void {
  expect(layer.index).toBe(expected.index)
  for (const key of ['opacity', 'x', 'y', 'scale'] as const) expect(layer[key]).toBeCloseTo(expected[key], 9)
}

const still = (index: number, opacity = 1): OutputSceneLayer => ({ index, opacity, x: 0, y: 0, scale: 1 })

test('a transition plays centered on its boundary for its duration, outgoing scene below', () => {
  const scenes = createScenes([0, 2000, 5000], { 1: { duration: 0.5 } })
  expect(getOutputTransitionWindow(scenes, 1, RATE, 8000)).toEqual({ start: 1750, end: 2250 })
  expect(layersAt(scenes, 1749)).toEqual([still(0)])
  expect(layersAt(scenes, 1750)).toEqual([still(0), still(1, 0)])
  expect(layersAt(scenes, 2000)).toEqual([still(0), still(1, 0.5)])
  const late = layersAt(scenes, 2249)
  expect(late.map((layer) => layer.index)).toEqual([0, 1])
  expect(late[1].opacity).toBeCloseTo(499 / 500, 9)
  expect(layersAt(scenes, 2250)).toEqual([still(1)])
  // Scene 2 cuts.
  expect(getOutputTransitionWindow(scenes, 2, RATE, 8000)).toBeNull()
  expect(layersAt(scenes, 4999)).toEqual([still(1)])
  expect(layersAt(scenes, 5000)).toEqual([still(2)])
})

test('transitions shorten to half of either adjacent scene, so consecutive ones never overlap', () => {
  const scenes = createScenes([0, 1000, 1400], { 1: { duration: 2 }, 2: { duration: 2 } })
  expect(getOutputTransitionWindow(scenes, 1, RATE, 3000)).toEqual({ start: 800, end: 1200 })
  expect(getOutputTransitionWindow(scenes, 2, RATE, 3000)).toEqual({ start: 1200, end: 1600 })
  // Scene 1 is never shown alone; its midpoint starts the next transition.
  expect(layersAt(scenes, 1199, 3000).map((layer) => layer.index)).toEqual([0, 1])
  expect(layersAt(scenes, 1200, 3000)).toEqual([still(1), still(2, 0)])
  // The last scene ends at the project length.
  expect(getOutputTransitionWindow(createScenes([0, 1000], { 1: { duration: 2 } }), 1, RATE, 1100)).toEqual({
    start: 950,
    end: 1050,
  })
})

test.each<[string, OutputScene[], number, number]>([
  ['the first scene', createScenes([0, 1000], { 0: { duration: 1 } }), 0, 2000],
  ['an unknown kind', createScenes([0, 1000], { 1: { kind: 'spin' as OutputTransition['kind'] } }), 1, 2000],
  ['a zero duration', createScenes([0, 1000], { 1: { duration: 0 } }), 1, 2000],
  ['a NaN duration', createScenes([0, 1000], { 1: { duration: NaN } }), 1, 2000],
  ['a negative duration', createScenes([0, 1000], { 1: { duration: -1 } }), 1, 2000],
  ['a scene past the project end', createScenes([0, 1000], { 1: { duration: 1 } }), 1, 900],
])('%s cuts', (_, scenes, index, projectLength) => {
  expect(getOutputTransitionWindow(scenes, index, RATE, projectLength)).toBeNull()
  for (const sample of [0, 500, 999, 1000, 1001]) {
    expect(layersAt(scenes, sample, projectLength)).toEqual([still(sample < 1000 ? 0 : 1)])
  }
})

test('nothing is visible before the first scene, and missing scenes have no transition', () => {
  const scenes = createScenes([0, 1000], { 1: { duration: 1 } })
  expect(layersAt(scenes, -1)).toEqual([])
  expect(layersAt([], 0)).toEqual([])
  for (const index of [-1, 2]) expect(getOutputTransitionWindow(scenes, index, RATE, 2000)).toBeNull()
})

test('fade through black is black at the boundary and never shows both scenes', () => {
  const scenes = createScenes([0, 1000], { 1: { kind: 'fade', duration: 1 } })
  expect(layersAt(scenes, 500)).toEqual([still(0), still(1, 0)])
  expect(layersAt(scenes, 750)).toEqual([still(0, 0.5), still(1, 0)])
  expect(layersAt(scenes, 1000)).toEqual([still(0, 0), still(1, 0)])
  expect(layersAt(scenes, 1250)).toEqual([still(0, 0), still(1, 0.5)])
  for (let sample = 500; sample < 1500; sample += 10) {
    const [outgoing, incoming] = layersAt(scenes, sample)
    expect(Math.min(outgoing.opacity, incoming.opacity)).toBe(0)
  }
})

test.each<[OutputTransition['direction'], number, number]>([
  ['left', -1, 0],
  ['right', 1, 0],
  ['up', 0, -1],
  ['down', 0, 1],
])('slide and push %s move the pictures that way', (direction, dx, dy) => {
  const slide = createScenes([0, 1000], { 1: { kind: 'slide', duration: 1, direction } })
  const push = createScenes([0, 1000], { 1: { kind: 'push', duration: 1, direction } })
  // The incoming picture starts just outside the opposite edge, on top.
  expectLayer(layersAt(slide, 500)[1], { index: 1, opacity: 1, x: -dx, y: -dy, scale: 1 })
  expectLayer(layersAt(push, 500)[1], { index: 1, opacity: 1, x: -dx, y: -dy, scale: 1 })
  // Halfway at the boundary; Slide covers the still outgoing picture while Push moves it out.
  expectLayer(layersAt(slide, 1000)[0], still(0))
  expectLayer(layersAt(slide, 1000)[1], { index: 1, opacity: 1, x: -dx / 2, y: -dy / 2, scale: 1 })
  expectLayer(layersAt(push, 1000)[0], { index: 0, opacity: 1, x: dx / 2, y: dy / 2, scale: 1 })
  expectLayer(layersAt(push, 1000)[1], { index: 1, opacity: 1, x: -dx / 2, y: -dy / 2, scale: 1 })
  // Motion eases: it is slower near either end than at the boundary.
  const travel = (from: number, to: number) => {
    const [start, end] = [layersAt(push, from)[1], layersAt(push, to)[1]]
    return Math.hypot(end.x - start.x, end.y - start.y)
  }
  expect(travel(500, 600)).toBeLessThan(travel(950, 1050))
  expect(layersAt(push, 1500)).toEqual([still(1)])
})

test('zoom grows the outgoing picture while the incoming one grows into place and fades in', () => {
  const scenes = createScenes([0, 1000], { 1: { kind: 'zoom', duration: 1 } })
  const [startOut, startIn] = layersAt(scenes, 500)
  expectLayer(startOut, still(0))
  expectLayer(startIn, { index: 1, opacity: 0, x: 0, y: 0, scale: 0.75 })
  const [middleOut, middleIn] = layersAt(scenes, 1000)
  expectLayer(middleOut, { index: 0, opacity: 1, x: 0, y: 0, scale: 1.125 })
  expectLayer(middleIn, { index: 1, opacity: 0.5, x: 0, y: 0, scale: 0.875 })
  expect(layersAt(scenes, 1500)).toEqual([still(1)])
})
