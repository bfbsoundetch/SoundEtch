import 'fake-indexeddb/auto'
import { expect, test, vi } from 'vitest'
import { DatabasePersister } from '../persistence/DatabasePersister'
import { Project } from './Project'
import { Track } from './Track'
import { ProjectManager } from './ProjectManager'
import { getOutputCropPosition, getOutputCropScale } from './OutputScene'
import { DEFAULT_OUTPUT_CAPTIONS } from './OutputCaptions'
import { ParameterValueSequence, ParamValueTransition } from '../effects/ParameterValueSequence'

function attachPlayback(track: Track) {
  const playerNode = {
    disconnect: vi.fn(),
    context: {
      state: 'running',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  } as unknown as AudioWorkletNode
  const gainNode = { gain: { value: 0 } } as GainNode
  const pannerNode = { pan: { value: 0 } } as StereoPannerNode
  track.registerNewPlayback(playerNode, gainNode, pannerNode)
  return { playerNode, gainNode }
}

test('mute and solo update live track audibility without changing fader gain', () => {
  const project = new Project('test', 48000)
  const first = new Track('first', 2)
  const second = new Track('second', 2)
  first.setGain(0.5)
  second.setGain(0.75)
  project.addTrack(first)
  project.addTrack(second)
  const firstPlayback = attachPlayback(first)
  const secondPlayback = attachPlayback(second)

  project.setTrackSoloed(first, true)

  expect(firstPlayback.gainNode.gain.value).toBe(0.5)
  expect(secondPlayback.gainNode.gain.value).toBe(0)

  project.setTrackSoloed(second, true)

  expect(firstPlayback.gainNode.gain.value).toBe(0.5)
  expect(secondPlayback.gainNode.gain.value).toBe(0.75)

  project.setTrackMuted(first, true)
  first.setGain(0.25)

  expect(first.getGain()).toBe(0.25)
  expect(firstPlayback.gainNode.gain.value).toBe(0)
  expect(secondPlayback.gainNode.gain.value).toBe(0.75)
})

test('deleting the last soloed track restores the remaining mix', () => {
  const project = new Project('test', 48000)
  const soloed = new Track('soloed', 2)
  const remaining = new Track('remaining', 2)
  project.addTrack(soloed)
  project.addTrack(remaining)
  const soloedPlayback = attachPlayback(soloed)
  const remainingPlayback = attachPlayback(remaining)
  project.setTrackSoloed(soloed, true)

  project.deleteTrack(soloed)

  expect(soloedPlayback.playerNode.disconnect).toHaveBeenCalledOnce()
  expect(remainingPlayback.gainNode.gain.value).toBe(1)
})

test('restoring older project records keeps the default output scene', async () => {
  const original = new Project('legacy project', 48_000)
  const record = DatabasePersister.toPersistedObject(original, true)
  delete record.outputScenes

  const restored = (await DatabasePersister.fromPersistedObject(record)) as Project

  expect(restored.title).toBe('legacy project')
  expect(restored.outputScenes).toEqual([{ startSample: 0, layout: 'single', fit: 'contain', tracks: [null, null] }])
})

test('opening projects migrates shadow on/off choices without overwriting a saved size or style', async () => {
  const original = await ProjectManager.getActiveProject()
  try {
    for (const [enabled, savedSize, expectedSize] of [
      [false, undefined, 0],
      [true, undefined, 100],
      [false, 175, 175],
      [true, 0, 0],
    ] as const) {
      const project = new Project('legacy caption shadow', 48_000)
      const legacy = { ...DEFAULT_OUTPUT_CAPTIONS, shadowEnabled: enabled, position: 'top' as const, shadowColor: '#112233' }
      delete legacy.shadowSize
      if (savedSize !== undefined) legacy.shadowSize = savedSize
      project.outputCaptions = legacy
      await DatabasePersister.save(project)

      const opened = await ProjectManager.openProject(project.id!)
      expect(opened.outputCaptions.shadowSize).toBe(expectedSize)
      expect(opened.outputCaptions.position).toBe('top')
      expect(opened.outputCaptions.shadowColor).toBe('#112233')
      expect(opened.outputCaptions).not.toHaveProperty('shadowEnabled')
      await ProjectManager.saveProject(opened)
      const record = (await DatabasePersister.getPersistedObjectGraph(project.id!)).find((entry) => entry.id === project.id)!
      const restored = await DatabasePersister.fromPersistedObject(record) as Project
      expect(restored.outputCaptions.shadowSize).toBe(expectedSize)
      expect(restored.outputCaptions).not.toHaveProperty('shadowEnabled')
    }
  } finally {
    await ProjectManager.openProject(original)
  }
})

test('output effects survive a database reload, and older project records restore without any', async () => {
  const legacy = DatabasePersister.toPersistedObject(new Project('legacy project', 48_000), true)
  delete legacy.outputEffects
  expect(((await DatabasePersister.fromPersistedObject(legacy)) as Project).outputEffects).toEqual([])

  const project = new Project('output chain', 48_000)
  const volume = new ParameterValueSequence(0.5)
  volume.transitionSequence.push(new ParamValueTransition('scurve', 1, 48_000))
  project.outputEffects.push(
    { instanceId: 'fade', id: 'soundetch.fade', params: { gain: volume }, bypassed: true },
    { instanceId: 'limiter', id: 'soundetch.limiter', params: { ceiling: new ParameterValueSequence(-1) } },
  )
  await DatabasePersister.save(project)
  const graph = await DatabasePersister.getPersistedObjectGraph(project.id!)
  const restored = (await DatabasePersister.fromPersistedObject(
    graph.find((record) => record.id === project.id)!,
  )) as Project

  expect(restored.outputEffects).toEqual([
    {
      instanceId: 'fade',
      id: 'soundetch.fade',
      params: {
        gain: { initialValue: 0.5, transitionSequence: [{ type: 'scurve', startValue: 1, startSample: 48_000 }] },
      },
      bypassed: true,
    },
    {
      instanceId: 'limiter',
      id: 'soundetch.limiter',
      params: { ceiling: { initialValue: -1, transitionSequence: [] } },
    },
  ])
})

test('database reload preserves per-scene and per-slot crops while legacy scenes stay centered', async () => {
  const project = new Project('output framing', 48_000)
  project.outputScenes = [
    { startSample: 0, layout: 'side-by-side', fit: 'cover', tracks: [null, null] },
    {
      startSample: 100,
      layout: 'side-by-side',
      fit: 'cover',
      tracks: [null, null],
      cropPositions: [
        { x: 0, y: 0.25, scale: 1.8 },
        { x: 1, y: 0.75, scale: 2.4 },
      ],
    },
    {
      startSample: 200,
      layout: 'single',
      fit: 'contain',
      tracks: [null, null],
      cropPositions: [
        { x: 0.2, y: 0.4, scale: 3.2 },
        { x: 0.6, y: 0.8, scale: 1.2 },
      ],
    },
  ]
  await DatabasePersister.save(project)
  const graph = await DatabasePersister.getPersistedObjectGraph(project.id!)
  const restored = (await DatabasePersister.fromPersistedObject(
    graph.find((record) => record.id === project.id)!,
  )) as Project

  expect(
    restored.outputScenes.map((scene) => [getOutputCropPosition(scene, 0), getOutputCropPosition(scene, 1)]),
  ).toEqual([
    [
      { x: 0.5, y: 0.5 },
      { x: 0.5, y: 0.5 },
    ],
    [
      { x: 0, y: 0.25, scale: 1.8 },
      { x: 1, y: 0.75, scale: 2.4 },
    ],
    [
      { x: 0.2, y: 0.4, scale: 3.2 },
      { x: 0.6, y: 0.8, scale: 1.2 },
    ],
  ])
  expect(restored.outputScenes.map((scene) => [getOutputCropScale(scene, 0), getOutputCropScale(scene, 1)])).toEqual([
    [1, 1],
    [1.8, 2.4],
    [3.2, 1.2],
  ])
  restored.outputScenes[1].cropPositions![0].x = 0.5
  restored.outputScenes[2].fit = 'cover'
  restored.outputScenes[1].cropPositions![0].scale = 4
  expect(getOutputCropPosition(restored.outputScenes[1], 1)).toEqual({ x: 1, y: 0.75, scale: 2.4 })
  expect(getOutputCropPosition(restored.outputScenes[2], 0)).toEqual({ x: 0.2, y: 0.4, scale: 3.2 })
  expect(getOutputCropPosition(project.outputScenes[1], 0)).toEqual({ x: 0, y: 0.25, scale: 1.8 })
})

test('deleting a source track clears both scene slots immutably and leaves a valid persisted graph', async () => {
  const project = new Project('output sources', 48_000)
  const removed = new Track('removed', 1)
  const remaining = new Track('remaining', 1)
  await DatabasePersister.save(removed)
  await DatabasePersister.save(remaining)
  project.addTrack(removed)
  project.addTrack(remaining)
  project.outputScenes = [
    {
      startSample: 0,
      layout: 'side-by-side',
      fit: 'cover',
      tracks: [removed, remaining],
      cropPositions: [
        { x: 0.2, y: 0.3 },
        { x: 0.7, y: 0.8 },
      ],
    },
    { startSample: 100, layout: 'single', fit: 'contain', tracks: [removed, removed] },
    { startSample: 200, layout: 'single', fit: 'cover', tracks: [null, remaining] },
  ]
  const before = project.outputScenes
  await DatabasePersister.save(project)

  await ProjectManager.deleteTrack(removed, project)

  expect(project.outputScenes).toEqual([
    {
      startSample: 0,
      layout: 'side-by-side',
      fit: 'cover',
      tracks: [null, remaining],
      cropPositions: [
        { x: 0.2, y: 0.3 },
        { x: 0.7, y: 0.8 },
      ],
    },
    { startSample: 100, layout: 'single', fit: 'contain', tracks: [null, null] },
    { startSample: 200, layout: 'single', fit: 'cover', tracks: [null, remaining] },
  ])
  expect(before[0].tracks).toEqual([removed, remaining])
  expect(before[1].tracks).toEqual([removed, removed])
  expect(project.outputScenes).not.toBe(before)
  const graph = await DatabasePersister.getPersistedObjectGraph(project.id!)
  expect(graph.map((record) => record.id).sort()).toEqual([project.id!, remaining.id!].sort())
  const persistedProject = graph.find((record) => record.id === project.id)!
  expect(persistedProject.outputScenes).toEqual([
    {
      startSample: 0,
      layout: 'side-by-side',
      fit: 'cover',
      tracks: [null, { i: remaining.id }],
      cropPositions: [
        { x: 0.2, y: 0.3 },
        { x: 0.7, y: 0.8 },
      ],
    },
    { startSample: 100, layout: 'single', fit: 'contain', tracks: [null, null] },
    { startSample: 200, layout: 'single', fit: 'cover', tracks: [null, { i: remaining.id }] },
  ])
  const restored = (await DatabasePersister.fromPersistedObject(persistedProject)) as Project
  expect(restored.outputScenes[0].tracks[1]).toBe(restored.getTracks()[0])
  expect(restored.outputScenes[1].tracks).toEqual([null, null])
  project.outputScenes[0].cropPositions![0].x = 1
  project.outputScenes[0].cropPositions![1].y = 0
  expect(getOutputCropPosition(before[0], 0)).toEqual({ x: 0.2, y: 0.3 })
  expect(getOutputCropPosition(before[0], 1)).toEqual({ x: 0.7, y: 0.8 })
  expect(getOutputCropPosition(restored.outputScenes[0], 0)).toEqual({ x: 0.2, y: 0.3 })
  expect(getOutputCropPosition(restored.outputScenes[0], 1)).toEqual({ x: 0.7, y: 0.8 })
})
