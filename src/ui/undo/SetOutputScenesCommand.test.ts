import 'fake-indexeddb/auto'
import { expect, test } from 'vitest'
import { DatabasePersister, type PersistedObject } from '../../persistence/DatabasePersister'
import type { OutputScene } from '../../project/OutputScene'
import { Project } from '../../project/Project'
import { Track } from '../../project/Track'
import { BackStack } from './BackStack'
import { SetOutputScenesCommand } from './SetOutputScenesCommand'

async function restoreScenes(project: Project): Promise<OutputScene[]> {
  const graph = await DatabasePersister.getPersistedObjectGraph(project.id!)
  const record = graph.find((candidate) => candidate.id === project.id)!
  const restored = (await DatabasePersister.fromPersistedObject(
    JSON.parse(JSON.stringify(record)) as PersistedObject,
  )) as Project
  return restored.outputScenes
}

test('scene commands snapshot inputs and restore exact persisted before and after contents on undo and redo', async () => {
  const project = new Project('output undo', 48_000)
  const first = new Track('first source', 1)
  const second = new Track('second source', 1)
  await DatabasePersister.save(first)
  await DatabasePersister.save(second)
  project.addTrack(first)
  project.addTrack(second)
  project.outputScenes = [
    {
      startSample: 0,
      layout: 'single',
      fit: 'contain',
      tracks: [first, null],
      cornerRadius: 24,
      margin: 16,
      cropPositions: [
        { x: 0.1, y: 0.2 },
        { x: 0.3, y: 0.4 },
      ],
    },
  ]
  await DatabasePersister.save(project)
  const before: readonly OutputScene[] = project.outputScenes
  const after: readonly OutputScene[] = [
    {
      startSample: 0,
      layout: 'side-by-side',
      fit: 'cover',
      tracks: [second, first],
      cornerRadius: 80,
      margin: 48,
      cropPositions: [
        { x: 0.8, y: 0.9 },
        { x: 0.6, y: 0.7 },
      ],
    },
    {
      startSample: 400,
      layout: 'single',
      fit: 'contain',
      tracks: [null, second],
      cornerRadius: 40,
      margin: 20,
      cropPositions: [
        { x: 0.2, y: 0.3 },
        { x: 0.4, y: 0.5 },
      ],
    },
  ]
  const expectedBefore: OutputScene[] = [
    {
      startSample: 0,
      layout: 'single',
      fit: 'contain',
      tracks: [first, null],
      cornerRadius: 24,
      margin: 16,
      cropPositions: [
        { x: 0.1, y: 0.2 },
        { x: 0.3, y: 0.4 },
      ],
    },
  ]
  const expectedAfter: OutputScene[] = [
    {
      startSample: 0,
      layout: 'side-by-side',
      fit: 'cover',
      tracks: [second, first],
      cornerRadius: 80,
      margin: 48,
      cropPositions: [
        { x: 0.8, y: 0.9 },
        { x: 0.6, y: 0.7 },
      ],
    },
    {
      startSample: 400,
      layout: 'single',
      fit: 'contain',
      tracks: [null, second],
      cornerRadius: 40,
      margin: 20,
      cropPositions: [
        { x: 0.2, y: 0.3 },
        { x: 0.4, y: 0.5 },
      ],
    },
  ]
  const command = new SetOutputScenesCommand(project, before, after, 'split output scene')
  before[0].fit = 'cover'
  before[0].tracks[0] = null
  after[0].startSample = 123
  after[0].tracks[0] = null
  before[0].cornerRadius = 0
  after[0].margin = 0
  before[0].cropPositions![0].x = 1
  before[0].cropPositions![1].y = 0
  after[0].cropPositions![0].y = 0
  after[0].cropPositions![1].x = 1
  after[1].cropPositions![1] = { x: 0, y: 1 }
  const history = new BackStack()
  await history.execute(command)
  const performed = project.outputScenes
  expect(history.undoActionString).toBe('split output scene')
  expect(project.outputScenes).toEqual(expectedAfter)
  expect(project.outputScenes[0].tracks[0]).toBe(second)
  expect(await restoreScenes(project)).toEqual(expectedAfter)

  performed[0].layout = 'single'
  performed[0].tracks[1] = null
  performed[0].cropPositions![0].x = 0
  performed[0].cropPositions![1].y = 1
  performed[0].margin = 0
  performed.pop()
  await history.undo()
  const undone = project.outputScenes
  expect(undone).toEqual(expectedBefore)
  expect(undone).not.toBe(before)
  expect(undone[0]).not.toBe(before[0])
  expect(undone[0].tracks).not.toBe(before[0].tracks)
  expect(await restoreScenes(project)).toEqual(expectedBefore)

  undone[0].startSample = 99
  undone[0].tracks[0] = null
  undone[0].cropPositions![0].y = 1
  undone[0].cropPositions![1].x = 0
  undone[0].cornerRadius = 0
  await history.redo()
  expect(project.outputScenes).toEqual(expectedAfter)
  expect(project.outputScenes).not.toBe(performed)
  expect(project.outputScenes[0].tracks).not.toBe(performed[0].tracks)
  expect(await restoreScenes(project)).toEqual(expectedAfter)
  await history.undo()
  expect(project.outputScenes).toEqual(expectedBefore)
})
