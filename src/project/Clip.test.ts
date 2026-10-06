import 'fake-indexeddb/auto'
import { DatabasePersister, type PersistedObject } from '../persistence/DatabasePersister'
import { Clip } from './Clip'

const transcription = [
  { text: 'all terrain', startSample: 1_000, endSample: 2_000 },
  { text: 'keeps moving', startSample: 4_000, endSample: 5_500 },
]

test('new clips have an empty transcription', () => {
  expect(new Clip('empty', 2).transcription).toEqual([])
})

test('transcription survives persistence and legacy records retain the empty default', async () => {
  const clip = new Clip('transcribed', 2, 10_000)
  clip.transcription = transcription
  await DatabasePersister.save(clip)

  const [rawRecord] = await DatabasePersister.getPersistedObjectGraph(clip.id!)
  const archiveRecord = JSON.parse(JSON.stringify(rawRecord)) as PersistedObject
  const restoredClip = (await DatabasePersister.fromPersistedObject(archiveRecord)) as Clip

  expect(restoredClip.transcription).toEqual(transcription)

  const legacyRecord = JSON.parse(JSON.stringify(rawRecord)) as PersistedObject
  delete legacyRecord.transcription
  const restoredLegacyClip = (await DatabasePersister.fromPersistedObject(legacyRecord)) as Clip

  expect(restoredLegacyClip.transcription).toEqual([])
})
