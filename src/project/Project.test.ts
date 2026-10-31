import 'fake-indexeddb/auto'
import { expect, test, vi } from 'vitest'
import { DatabasePersister } from '../persistence/DatabasePersister'
import { Project } from './Project'
import { Track } from './Track'
import { ProjectManager } from './ProjectManager'

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

test('deleting a source track clears both scene slots immutably and leaves a valid persisted graph', async () => {
  const project = new Project('output sources', 48_000)
  const removed = new Track('removed', 1)
  const remaining = new Track('remaining', 1)
  await DatabasePersister.save(removed)
  await DatabasePersister.save(remaining)
  project.addTrack(removed)
  project.addTrack(remaining)
  project.outputScenes = [
    { startSample: 0, layout: 'side-by-side', fit: 'cover', tracks: [removed, remaining] },
    { startSample: 100, layout: 'single', fit: 'contain', tracks: [removed, removed] },
    { startSample: 200, layout: 'single', fit: 'cover', tracks: [null, remaining] },
  ]
  const before = project.outputScenes
  await DatabasePersister.save(project)

  await ProjectManager.deleteTrack(removed, project)

  expect(project.outputScenes).toEqual([
    { startSample: 0, layout: 'side-by-side', fit: 'cover', tracks: [null, remaining] },
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
    { startSample: 0, layout: 'side-by-side', fit: 'cover', tracks: [null, { i: remaining.id }] },
    { startSample: 100, layout: 'single', fit: 'contain', tracks: [null, null] },
    { startSample: 200, layout: 'single', fit: 'cover', tracks: [null, { i: remaining.id }] },
  ])
  const restored = (await DatabasePersister.fromPersistedObject(persistedProject)) as Project
  expect(restored.outputScenes[0].tracks[1]).toBe(restored.getTracks()[0])
  expect(restored.outputScenes[1].tracks).toEqual([null, null])
})
