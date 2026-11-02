import { expect, test } from 'vitest'
import {
  clampOutputCropScale,
  getOutputCropPosition,
  getOutputCropScale,
  getOutputSceneIndex,
  getOutputTransition,
  MAX_OUTPUT_CROP_SCALE,
  MIN_OUTPUT_CROP_SCALE,
  moveOutputSceneBoundary,
  splitOutputScene,
  type OutputScene,
} from './OutputScene'
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
    {
      startSample: 100,
      layout: 'side-by-side',
      fit: 'cover',
      tracks: [secondTrack, firstTrack],
      cornerRadius: 64,
      margin: 32,
      cropPositions: [
        { x: 0.1, y: 0.2 },
        { x: 0.8, y: 0.9 },
      ],
    },
    {
      startSample: 400,
      layout: 'single',
      fit: 'contain',
      tracks: [firstTrack, null],
      cropPositions: [
        { x: 0.3, y: 0.4 },
        { x: 0.6, y: 0.7 },
      ],
    },
  ]
  const split = splitOutputScene(scenes, 250, 500)!
  expect(split.map((scene) => scene.startSample)).toEqual([0, 100, 250, 400])
  expect(split[2]).toEqual({ ...scenes[1], startSample: 250 })
  expect(split[2].tracks[0]).toBe(secondTrack)
  expect(split[2].tracks[1]).toBe(firstTrack)
  expect(getOutputSceneIndex(split, 249)).toBe(1)
  expect(getOutputSceneIndex(split, 250)).toBe(2)
  expect(getOutputSceneIndex(split, 400)).toBe(3)
  expect(getOutputCropPosition(split[2], 0)).toEqual({ x: 0.1, y: 0.2 })
  expect(getOutputCropPosition(split[2], 1)).toEqual({ x: 0.8, y: 0.9 })
  split[2].cropPositions![0].x = 1
  split[2].cornerRadius = 120
  split[1].margin = 80
  expect(scenes[1].cornerRadius).toBe(64)
  expect(scenes[1].margin).toBe(32)
  expect(split[1].cornerRadius).toBe(64)
  expect(split[2].margin).toBe(32)
  split[2].cropPositions![1].y = 0
  split[1].cropPositions![0].y = 1
  split[1].cropPositions![1].x = 0
  split[3].cropPositions![0].x = 0.5
  expect(getOutputCropPosition(scenes[1], 0)).toEqual({ x: 0.1, y: 0.2 })
  expect(getOutputCropPosition(scenes[1], 1)).toEqual({ x: 0.8, y: 0.9 })
  expect(getOutputCropPosition(split[1], 0)).toEqual({ x: 0.1, y: 1 })
  expect(getOutputCropPosition(split[1], 1)).toEqual({ x: 0, y: 0.9 })
  expect(getOutputCropPosition(split[2], 0)).toEqual({ x: 1, y: 0.2 })
  expect(getOutputCropPosition(split[2], 1)).toEqual({ x: 0.8, y: 0 })
  expect(getOutputCropPosition(scenes[2], 0)).toEqual({ x: 0.3, y: 0.4 })
  expect(getOutputCropPosition(split[3], 1)).toEqual({ x: 0.6, y: 0.7 })
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

test('crop scales default to base cover and clamp without changing saved scene data', () => {
  const scene = new Project('crop scales', 48_000).outputScenes[0]
  expect(getOutputCropScale(scene, 0)).toBe(MIN_OUTPUT_CROP_SCALE)
  expect(getOutputCropScale(scene, 1)).toBe(MIN_OUTPUT_CROP_SCALE)
  scene.cropPositions = [
    { x: 0.1, y: 0.2 },
    { x: 0.8, y: 0.9, scale: 2.3 },
  ]
  expect(getOutputCropScale(scene, 0)).toBe(1)
  expect(getOutputCropScale(scene, 1)).toBe(2.3)
  scene.cropPositions[0].scale = 0.5
  scene.cropPositions[1].scale = 5
  expect(getOutputCropScale(scene, 0)).toBe(MIN_OUTPUT_CROP_SCALE)
  expect(getOutputCropScale(scene, 1)).toBe(MAX_OUTPUT_CROP_SCALE)
  expect(scene.cropPositions.map((position) => position.scale)).toEqual([0.5, 5])
  expect(clampOutputCropScale(NaN)).toBe(1)
  expect(clampOutputCropScale(-Infinity)).toBe(1)
  expect(clampOutputCropScale(Infinity)).toBe(4)
})

test('splits inherit independent per-slot scales and Fit remembers saved crop zoom', () => {
  const scene: OutputScene = {
    startSample: 0,
    layout: 'side-by-side',
    fit: 'cover',
    tracks: [null, null],
    cropPositions: [
      { x: 0.2, y: 0.3, scale: 1.4 },
      { x: 0.7, y: 0.8, scale: 2.6 },
    ],
  }
  const split = splitOutputScene([scene], 100, 200)!
  expect(split.map((part) => [getOutputCropScale(part, 0), getOutputCropScale(part, 1)])).toEqual([
    [1.4, 2.6],
    [1.4, 2.6],
  ])
  split[1].cropPositions![0].scale = 3.1
  split[1].cropPositions![0].x = 0.9
  split[1].fit = 'contain'
  split[1].layout = 'single'
  split[1].tracks[0] = new Track('replacement', 1)
  expect(getOutputCropScale(split[1], 0)).toBe(3.1)
  expect(getOutputCropScale(split[1], 1)).toBe(2.6)
  expect(getOutputCropScale(split[0], 0)).toBe(1.4)
  expect(getOutputCropScale(scene, 0)).toBe(1.4)
  split[1].fit = 'cover'
  split[1].layout = 'side-by-side'
  expect(getOutputCropPosition(split[1], 0)).toEqual({ x: 0.9, y: 0.3, scale: 3.1 })
  expect(getOutputCropPosition(split[1], 1)).toEqual({ x: 0.7, y: 0.8, scale: 2.6 })
})

test('moving a boundary changes scene ownership without shifting other scenes or their styling', () => {
  const source = new Track('camera', 1)
  const scenes: OutputScene[] = [
    { startSample: 0, layout: 'single', fit: 'contain', tracks: [null, null] },
    {
      startSample: 100,
      layout: 'side-by-side',
      fit: 'cover',
      tracks: [source, source],
      margin: 32,
      cornerRadius: 64,
      cropPositions: [
        { x: 0.2, y: 0.3, scale: 1.5 },
        { x: 0.8, y: 0.7, scale: 2 },
      ],
    },
    { startSample: 250, layout: 'single', fit: 'cover', tracks: [source, null] },
  ]
  const moved = moveOutputSceneBoundary(scenes, 1, 175, 400)!
  expect(moved.map((scene) => scene.startSample)).toEqual([0, 175, 250])
  expect(moved[1]).toEqual({ ...scenes[1], startSample: 175 })
  expect(moved[1].tracks[0]).toBe(source)
  expect(getOutputSceneIndex(moved, 174)).toBe(0)
  expect(getOutputSceneIndex(moved, 175)).toBe(1)
  expect(getOutputSceneIndex(moved, 250)).toBe(2)
  expect(scenes[1].startSample).toBe(100)
})

test.each([
  [1, 0, [0, 200], [1, 2]],
  [1, -50, [0, 200], [1, 2]],
  [1, 200, [0, 200], [0, 2]],
  [1, 350, [0, 200], [0, 2]],
  [2, 100, [0, 100], [0, 2]],
  [2, 0, [0, 100], [0, 2]],
  [2, 300, [0, 100], [0, 1]],
  [2, 400, [0, 100], [0, 1]],
])('boundary %s moved to %s removes just the scene collapsed to zero', (index, sample, starts, survivors) => {
  const scenes: OutputScene[] = [0, 100, 200].map((startSample, index) => ({
    startSample,
    layout: 'single',
    fit: 'contain',
    tracks: [null, null],
    margin: index * 20,
  }))
  const moved = moveOutputSceneBoundary(scenes, index, sample, 300)!
  expect(moved.map((scene) => scene.startSample)).toEqual(starts)
  expect(moved.map((scene) => scene.margin)).toEqual(survivors.map((index) => scenes[index].margin))
  expect(moved.every((scene, i) => (moved[i + 1]?.startSample ?? 300) > scene.startSample)).toBe(true)
  expect(scenes.map((scene) => scene.startSample)).toEqual([0, 100, 200])
})

test('collapsing either end scene leaves one scene covering the entire project', () => {
  const scenes: OutputScene[] = [
    { startSample: 0, layout: 'single', fit: 'contain', tracks: [null, null] },
    { startSample: 100, layout: 'side-by-side', fit: 'cover', tracks: [null, null] },
  ]
  expect(moveOutputSceneBoundary(scenes, 1, 0, 200)).toEqual([{ ...scenes[1], startSample: 0 }])
  expect(moveOutputSceneBoundary(scenes, 1, 200, 200)).toEqual([scenes[0]])
  expect(moveOutputSceneBoundary([scenes[0]], 0, 200, 200)).toBeNull()
})

test.each([NaN, Infinity, -Infinity, 0.5])('invalid boundary position %s cannot change scenes', (sample) => {
  const scenes = splitOutputScene(new Project('test', 48_000).outputScenes, 100, 200)!
  expect(moveOutputSceneBoundary(scenes, 1, sample, 200)).toBeNull()
})

test('unchanged, nonexistent, and non-interior boundaries do not produce scene edits', () => {
  const scenes = splitOutputScene(new Project('test', 48_000).outputScenes, 100, 200)!
  expect(moveOutputSceneBoundary(scenes, 1, 100, 200)).toBeNull()
  for (const index of [-1, 0, 0.5, 2, NaN]) {
    expect(moveOutputSceneBoundary(scenes, index, 150, 200)).toBeNull()
  }
  expect(moveOutputSceneBoundary(scenes, 1, 150, 0)).toBeNull()
  expect(moveOutputSceneBoundary([], 1, 150, 200)).toBeNull()
})

test('a split leaves the new boundary a cut while the containing scene keeps its transition', () => {
  const scenes: OutputScene[] = [
    { startSample: 0, layout: 'single', fit: 'contain', tracks: [null, null] },
    {
      startSample: 100,
      layout: 'single',
      fit: 'cover',
      tracks: [null, null],
      transition: { kind: 'push', duration: 1, direction: 'up' },
    },
  ]
  const split = splitOutputScene(scenes, 150, 200)!
  expect(split.map((_, index) => getOutputTransition(split, index))).toEqual([
    null,
    { kind: 'push', duration: 1, direction: 'up' },
    null,
  ])
  split[1].transition!.duration = 2
  expect(scenes[1].transition!.duration).toBe(1)
})

test('collapsing a scene removes its transition, and a scene that becomes first loses its own', () => {
  const scenes: OutputScene[] = (['crossfade', 'fade', 'slide'] as const).map((kind, index) => ({
    startSample: index * 100,
    layout: 'single',
    fit: 'contain',
    tracks: [null, null],
    transition: { kind, duration: 0.5, direction: 'left' },
  }))
  const kinds = (moved: OutputScene[]) => moved.map((_, index) => getOutputTransition(moved, index)?.kind ?? null)
  // Either way scene 2 is removed with its fade, and the slide into scene 3 remains.
  expect(kinds(moveOutputSceneBoundary(scenes, 1, 200, 300)!)).toEqual([null, 'slide'])
  expect(kinds(moveOutputSceneBoundary(scenes, 2, 100, 300)!)).toEqual([null, 'slide'])
  const firstRemoved = moveOutputSceneBoundary(scenes, 1, 0, 300)!
  expect(firstRemoved.map((scene) => [scene.startSample, scene.transition?.kind])).toEqual([
    [0, undefined],
    [200, 'slide'],
  ])
})
