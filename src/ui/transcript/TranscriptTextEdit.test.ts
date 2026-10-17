import { expect, test } from 'vitest'
import { Clip } from '../../project/Clip'
import { ClipView } from '../../project/ClipView'
import { Track } from '../../project/Track'
import { getTrackTranscriptEntries } from './TrackTranscript'
import { getTranscriptTextEdits } from './TranscriptTextEdit'

function fixture() {
  const clip = new Clip('source', 1, 120)
  clip.transcription = [
    { text: ' first phrase ', startSample: 0, endSample: 20, speechStartSample: 0 },
    { text: '', startSample: 20, endSample: 40, kind: 'silence' },
    { text: 'second', startSample: 40, endSample: 60, speechStartSample: 40 },
    { text: '', startSample: 60, endSample: 80, kind: 'untranscribed', speechStartSample: 60 },
    { text: 'last phrase', startSample: 80, endSample: 120, speechStartSample: 80 },
  ]
  const track = new Track('track', 1)
  return { clip, track }
}

test('one placement becomes a phrase interval including intervening pauses and source words', () => {
  const { clip, track } = fixture()
  track.clipViews.push(new ClipView(clip, 0, 1000, 120))
  const entries = getTrackTranscriptEntries(track)
  const transcription = clip.transcription
  const originalRanges = transcription.map((range) => ({ ...range }))
  const selected = [entries[0], entries[4]]

  expect(getTranscriptTextEdits(selected)).toEqual([
    { clip, startSample: 0, endSample: 120, text: 'first phrase second last phrase', speechStartSample: 0 },
  ])
  expect(clip.transcription).toBe(transcription)
  expect(clip.transcription).toEqual(originalRanges)
  expect(selected).toEqual([entries[0], entries[4]])
})

test('trimmed phrases recover full source timing using intersection rather than projected indices', () => {
  const { clip, track } = fixture()
  track.clipViews.push(new ClipView(clip, 90, 1000, 10))
  const entries = getTrackTranscriptEntries(track)
  expect(entries.map((entry) => [entry.rangeIndex, entry.startSample, entry.endSample])).toEqual([[0, 1000, 1010]])

  expect(getTranscriptTextEdits(entries)).toEqual([
    { clip, startSample: 80, endSample: 120, text: 'last phrase', speechStartSample: 80 },
  ])
})

test('repeated placements of the same trimmed source word produce one edit', () => {
  const { clip, track } = fixture()
  track.clipViews.push(new ClipView(clip, 85, 1000, 15), new ClipView(clip, 100, 2000, 10))

  expect(getTranscriptTextEdits(getTrackTranscriptEntries(track))).toEqual([
    { clip, startSample: 80, endSample: 120, text: 'last phrase', speechStartSample: 80 },
  ])
})

test('overlapping and touching source intervals merge transitively across repeated placements', () => {
  const { clip, track } = fixture()
  track.clipViews.push(
    new ClipView(clip, 0, 1000, 60),
    new ClipView(clip, 80, 2000, 40),
    new ClipView(clip, 40, 3000, 40),
  )

  expect(getTranscriptTextEdits(getTrackTranscriptEntries(track))).toEqual([
    { clip, startSample: 0, endSample: 120, text: 'first phrase second last phrase', speechStartSample: 0 },
  ])
})

test('disjoint repeated source selections stay separate and follow selected occurrence order', () => {
  const { clip, track } = fixture()
  track.clipViews.push(new ClipView(clip, 80, 1000, 40), new ClipView(clip, 0, 2000, 20))

  expect(getTranscriptTextEdits(getTrackTranscriptEntries(track))).toEqual([
    { clip, startSample: 80, endSample: 120, text: 'last phrase', speechStartSample: 80 },
    { clip, startSample: 0, endSample: 20, text: 'first phrase', speechStartSample: 0 },
  ])
})

test('merged intervals retain first selected occurrence order relative to other clips', () => {
  const { clip, track } = fixture()
  const other = new Clip('other', 1, 120)
  other.transcription = [{ text: 'other clip', startSample: 0, endSample: 20, speechStartSample: 0 }]
  track.clipViews.push(
    new ClipView(clip, 40, 1000, 20),
    new ClipView(other, 0, 2000, 20),
    new ClipView(clip, 0, 3000, 60),
  )

  expect(getTranscriptTextEdits(getTrackTranscriptEntries(track))).toEqual([
    { clip, startSample: 0, endSample: 60, text: 'first phrase second', speechStartSample: 0 },
    { clip: other, startSample: 0, endSample: 20, text: 'other clip', speechStartSample: 0 },
  ])
})

test('gap-only edits stay trim-clamped and never use gap text as recognized words', () => {
  const { clip, track } = fixture()
  clip.transcription = clip.transcription.map((range) =>
    range.kind === undefined ? range : { ...range, text: 'Gap label, not recognized words' },
  )
  track.clipViews.push(new ClipView(clip, 65, 1000, 10), new ClipView(clip, 25, 2000, 10))

  expect(getTranscriptTextEdits(getTrackTranscriptEntries(track))).toEqual([
    { clip, startSample: 65, endSample: 75, text: '', speechStartSample: 60 },
    { clip, startSample: 25, endSample: 35, text: '', speechStartSample: undefined },
  ])
})

test('the first source word supplies paragraph membership instead of an earlier selected gap', () => {
  const { clip, track } = fixture()
  track.clipViews.push(new ClipView(clip, 60, 1000, 60))

  expect(getTranscriptTextEdits(getTrackTranscriptEntries(track))).toEqual([
    { clip, startSample: 60, endSample: 120, text: 'last phrase', speechStartSample: 80 },
  ])
})

test('an empty selection has no editing targets', () => {
  expect(getTranscriptTextEdits([])).toEqual([])
})
