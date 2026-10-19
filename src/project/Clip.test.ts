import 'fake-indexeddb/auto'
import { DatabasePersister, type PersistedObject } from '../persistence/DatabasePersister'
import { Clip } from './Clip'

const transcription = [
  { text: 'all terrain', startSample: 1_000, endSample: 2_000, speechStartSample: 500 },
  { text: 'keeps moving', startSample: 4_000, endSample: 5_500, speechStartSample: 3_500 },
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

test('video-only duration and source segments survive persistence without an audio summary', async () => {
  const clip = new Clip('silent footage', 1)
  clip.audioPresent = false
  clip.videoLength = 96_000
  clip.videoSegments = [
    { index: 0, trackNumber: 2, startSample: 24_000, length: 72_000, mediaStartSeconds: 1.5, mimeType: 'video/mp4' },
  ]
  await DatabasePersister.save(clip)
  const [rawRecord] = await DatabasePersister.getPersistedObjectGraph(clip.id!)
  const restored = (await DatabasePersister.fromPersistedObject(JSON.parse(JSON.stringify(rawRecord)))) as Clip

  expect(restored.length).toBe(96_000)
  expect(restored.summary.length).toBe(0)
  expect(restored.audioPresent).toBe(false)
  expect(restored.videoSegments).toEqual(clip.videoSegments)

  const legacy = { ...rawRecord }
  delete legacy.audioPresent
  delete legacy.videoLength
  delete legacy.videoSegments
  const restoredLegacy = (await DatabasePersister.fromPersistedObject(legacy)) as Clip
  restoredLegacy.length = 48_000
  expect(restoredLegacy.length).toBe(48_000)
  expect(restoredLegacy.audioPresent).toBe(true)
  expect(restoredLegacy.videoSegments).toEqual([])
})

test('linked media lasts through the longer audio or video component', () => {
  const clip = new Clip('linked footage', 2, 48_000)
  clip.videoLength = 96_000
  expect(clip.length).toBe(96_000)
  clip.length = 144_000
  expect(clip.summary.length).toBe(144_000)
  expect(clip.length).toBe(144_000)
})
