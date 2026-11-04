import 'fake-indexeddb/auto'
import { expect, test } from 'vitest'
import { DatabasePersister, type PersistedObject } from '../../persistence/DatabasePersister'
import { DEFAULT_OUTPUT_CAPTIONS } from '../../project/OutputCaptions'
import { Project } from '../../project/Project'
import { Track } from '../../project/Track'
import { BackStack } from './BackStack'
import { SetOutputCaptionsCommand } from './SetOutputCaptionsCommand'

async function restoreProject(project: Project): Promise<Project> {
  const graph = await DatabasePersister.getPersistedObjectGraph(project.id!)
  const record = graph.find((candidate) => candidate.id === project.id)!
  return await DatabasePersister.fromPersistedObject(JSON.parse(JSON.stringify(record)) as PersistedObject) as Project
}

test('caption source and styling survive persisted undo and redo without sharing mutable snapshots', async () => {
  const project = new Project('caption undo', 48_000)
  const narration = new Track('narration', 1)
  await DatabasePersister.save(narration)
  project.addTrack(narration)
  await DatabasePersister.save(project)
  const before = { ...project.outputCaptions }
  const after = {
    ...before,
    enabled: true,
    track: narration,
    followLoudest: false,
    fontFamily: 'Georgia, serif',
    fontSize: 96,
    position: 'top' as const,
    color: '#11ccff',
    highlightColor: '#ff2266',
    borderEnabled: false,
    borderColor: '#44dd88',
  }
  const expected = { ...after }
  const command = new SetOutputCaptionsCommand(project, before, after)
  after.color = '#000000'
  const history = new BackStack()
  await history.execute(command)
  expect(project.outputCaptions).toEqual(expected)
  const restored = await restoreProject(project)
  expect(restored.outputCaptions).toEqual({ ...expected, track: restored.getTracks()[0] })
  expect(restored.outputCaptions.track).toBe(restored.getTracks()[0])
  project.outputCaptions.fontSize = 24
  await history.undo()
  expect((await restoreProject(project)).outputCaptions).toEqual(before)
  project.outputCaptions.color = '#000000'
  await history.redo()
  expect(project.outputCaptions).toEqual(expected)
  expect((await restoreProject(project)).outputCaptions.color).toBe('#11ccff')
})

test('loudest source survives reload and persisted undo restores the explicit source', async () => {
  const project = new Project('loudest caption undo', 48_000)
  const narration = new Track('narration', 1)
  await DatabasePersister.save(narration)
  project.addTrack(narration)
  const before = { ...DEFAULT_OUTPUT_CAPTIONS, enabled: true, track: narration }
  // Existing saved settings can select a track without having the new mode flag.
  delete before.followLoudest
  project.outputCaptions = { ...before }
  await DatabasePersister.save(project)
  const legacy = await restoreProject(project)
  expect(legacy.outputCaptions.followLoudest).toBeFalsy()
  expect(legacy.outputCaptions.track).toBe(legacy.getTracks()[0])
  const after = { ...before, followLoudest: true, track: null }
  const history = new BackStack()
  await history.execute(new SetOutputCaptionsCommand(project, before, after))
  const restored = await restoreProject(project)
  expect(restored.outputCaptions).toEqual(after)
  expect(restored.outputCaptions.followLoudest).toBe(true)
  expect(restored.outputCaptions.track).toBeNull()
  await history.undo()
  const undone = await restoreProject(project)
  expect(undone.outputCaptions.followLoudest).toBeFalsy()
  expect(undone.outputCaptions.track).toBe(undone.getTracks()[0])
  expect(undone.outputCaptions.enabled).toBe(true)
  await history.redo()
  expect((await restoreProject(project)).outputCaptions).toEqual(after)
})

test('deleting an explicit caption source disables captions instead of switching speakers', () => {
  const project = new Project('caption source removal', 48_000)
  const source = new Track('narration', 1)
  const other = new Track('other speaker', 1)
  project.addTrack(source)
  project.addTrack(other)
  project.outputCaptions = { ...DEFAULT_OUTPUT_CAPTIONS, enabled: true, followLoudest: false, track: source, fontSize: 96 }
  project.deleteTrack(other)
  expect(project.outputCaptions.enabled).toBe(true)
  expect(project.outputCaptions.track).toBe(source)
  project.deleteTrack(source)
  expect(project.outputCaptions.enabled).toBe(false)
  expect(project.outputCaptions.track).toBeNull()
  expect(project.outputCaptions.fontSize).toBe(96)
})

test('older projects load with captions off rather than adding text to existing exports', async () => {
  const record = DatabasePersister.toPersistedObject(new Project('legacy', 48_000), true)
  delete record.outputCaptions
  const restored = await DatabasePersister.fromPersistedObject(record) as Project
  expect(restored.outputCaptions.enabled).toBe(false)
  expect(restored.outputCaptions.track).toBeNull()
})
