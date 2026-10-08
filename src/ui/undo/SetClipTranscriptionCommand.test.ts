import 'fake-indexeddb/auto'
import { DatabasePersister } from '../../persistence/DatabasePersister'
import type { PersistedObject } from '../../persistence/DatabasePersister'
import { Clip } from '../../project/Clip'
import type { TranscribedRange } from '../../project/Transcription'
import { BackStack } from './BackStack'
import { BatchCommand, SetClipTranscriptionCommand } from './UndoableActions'

async function restoreTranscription(clip: Clip): Promise<TranscribedRange[]> {
  const records = await DatabasePersister.getPersistedObjectGraph(clip.id!)
  const record = records.find((candidate) => candidate.id === clip.id)!
  const restored = (await DatabasePersister.fromPersistedObject(
    JSON.parse(JSON.stringify(record)) as PersistedObject,
  )) as Clip
  return restored.transcription
}

test('a transcription batch persists two clips through perform, undo, and redo with fresh arrays', async () => {
  const first = new Clip('first', 1, 10_000)
  const second = new Clip('second', 1, 10_000)
  first.transcription = [{ text: 'first old', startSample: 100, endSample: 200 }]
  second.transcription = [{ text: 'second old', startSample: 300, endSample: 400 }]
  await Promise.all([DatabasePersister.save(first), DatabasePersister.save(second)])

  const firstOldIdentity = first.transcription
  const secondOldIdentity = second.transcription
  const firstNew = [{ text: 'first new', startSample: 500, endSample: 600 }]
  const secondNew = [{ text: 'second new', startSample: 700, endSample: 800 }]
  const history = new BackStack()
  const batch = new BatchCommand(
    [
      new SetClipTranscriptionCommand(first, first.transcription, firstNew),
      new SetClipTranscriptionCommand(second, second.transcription, secondNew),
    ],
    'generate transcription',
  )

  await history.execute(batch)
  const firstPerformedIdentity = first.transcription
  const secondPerformedIdentity = second.transcription
  expect(first.transcription).toEqual(firstNew)
  expect(second.transcription).toEqual(secondNew)
  expect(firstPerformedIdentity).not.toBe(firstOldIdentity)
  expect(secondPerformedIdentity).not.toBe(secondOldIdentity)
  expect(await restoreTranscription(first)).toEqual(firstNew)
  expect(await restoreTranscription(second)).toEqual(secondNew)

  await history.undo()
  const firstUndoIdentity = first.transcription
  const secondUndoIdentity = second.transcription
  expect(first.transcription).toEqual(firstOldIdentity)
  expect(second.transcription).toEqual(secondOldIdentity)
  expect(firstUndoIdentity).not.toBe(firstPerformedIdentity)
  expect(secondUndoIdentity).not.toBe(secondPerformedIdentity)
  expect(await restoreTranscription(first)).toEqual(firstOldIdentity)
  expect(await restoreTranscription(second)).toEqual(secondOldIdentity)

  await history.redo()
  expect(first.transcription).toEqual(firstNew)
  expect(second.transcription).toEqual(secondNew)
  expect(first.transcription).not.toBe(firstPerformedIdentity)
  expect(second.transcription).not.toBe(secondPerformedIdentity)
  expect(first.transcription).not.toBe(firstUndoIdentity)
  expect(second.transcription).not.toBe(secondUndoIdentity)
  expect(await restoreTranscription(first)).toEqual(firstNew)
  expect(await restoreTranscription(second)).toEqual(secondNew)
})
