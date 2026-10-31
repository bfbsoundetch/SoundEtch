import { expect, test } from 'vitest'
import { getOutputSceneIndex, splitOutputScene, type OutputScene } from './OutputScene'
import { Project } from './Project'
import { Track } from './Track'

test('projects start with an independent automatic single scene at zero', () => {
  const first = new Project('first', 48_000)
  const second = new Project('second', 48_000)
  expect(first.outputScenes).toEqual([{ startSample: 0, layout: 'single', fit: 'contain', tracks: [null, null] }])
  first.outputScenes[0].fit = 'cover'
  first.outputScenes[0].tracks[0] = new Track('source', 1)
  expect(second.outputScenes[0].fit).toBe('contain')
  expect(second.outputScenes[0].tracks).toEqual([null, null])
})

test('scene lookup assigns exact boundaries to the right scene', () => {
  const scenes: OutputScene[] = [0, 100, 250].map((startSample) => ({
    startSample,
    layout: 'single',
    fit: 'contain',
    tracks: [null, null],
  }))
  expect(getOutputSceneIndex([], 0)).toBe(-1)
  expect(getOutputSceneIndex(scenes, -1)).toBe(-1)
  expect(getOutputSceneIndex(scenes, 0)).toBe(0)
  expect(getOutputSceneIndex(scenes, 99)).toBe(0)
  expect(getOutputSceneIndex(scenes, 100)).toBe(1)
  expect(getOutputSceneIndex(scenes, 249)).toBe(1)
  expect(getOutputSceneIndex(scenes, 250)).toBe(2)
  expect(getOutputSceneIndex(scenes, 1000)).toBe(2)
})

test('splitting inherits the containing scene without sharing mutable scene data', () => {
  const firstTrack = new Track('first', 1)
  const secondTrack = new Track('second', 1)
  const scenes: readonly OutputScene[] = [
    { startSample: 0, layout: 'single', fit: 'contain', tracks: [null, null] },
    { startSample: 100, layout: 'side-by-side', fit: 'cover', tracks: [secondTrack, firstTrack] },
    { startSample: 400, layout: 'single', fit: 'contain', tracks: [firstTrack, null] },
  ]
  const split = splitOutputScene(scenes, 250, 500)!
  expect(split.map((scene) => scene.startSample)).toEqual([0, 100, 250, 400])
  expect(split[2]).toEqual({ ...scenes[1], startSample: 250 })
  expect(split[2].tracks[0]).toBe(secondTrack)
  expect(split[2].tracks[1]).toBe(firstTrack)
  expect(getOutputSceneIndex(split, 249)).toBe(1)
  expect(getOutputSceneIndex(split, 250)).toBe(2)
  expect(getOutputSceneIndex(split, 400)).toBe(3)
  split[2].fit = 'contain'
  split[2].tracks[0] = null
  split[1].tracks[1] = null
  expect(scenes[1].fit).toBe('cover')
  expect(scenes[1].tracks).toEqual([secondTrack, firstTrack])
  expect(split[1].tracks[0]).toBe(secondTrack)
  expect(split[2].tracks[1]).toBe(firstTrack)
  expect(scenes).toHaveLength(3)
})

test.each([-1, 0, 100, 200, 201, 0.5, NaN, Infinity])(
  'splitting at %s rejects outside samples, scene boundaries, and noninteger samples',
  (sample) => {
    const scenes: OutputScene[] = [
      { startSample: 0, layout: 'single', fit: 'contain', tracks: [null, null] },
      { startSample: 100, layout: 'side-by-side', fit: 'cover', tracks: [null, null] },
    ]
    expect(splitOutputScene(scenes, sample, 200)).toBeNull()
    expect(scenes.map((scene) => scene.startSample)).toEqual([0, 100])
  },
)

test('splits next to either project endpoint create positive-length scenes', () => {
  const scenes = new Project('test', 48_000).outputScenes
  const firstSplit = splitOutputScene(scenes, 1, 200)!
  const lastSplit = splitOutputScene(firstSplit, 199, 200)!
  expect(lastSplit.map((scene) => scene.startSample)).toEqual([0, 1, 199])
  expect(splitOutputScene(lastSplit, 199, 200)).toBeNull()
  expect(splitOutputScene(scenes, 1, 0)).toBeNull()
  expect(splitOutputScene([], 1, 200)).toBeNull()
})
