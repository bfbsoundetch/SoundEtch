import { expect, test } from 'vitest'
import { Clip } from '../../project/Clip'
import { ClipView } from '../../project/ClipView'
import { rippleDelete } from '../../project/RippleEdit'
import { Track } from '../../project/Track'
import { getTrackTranscriptEntries, getTranscriptEntriesInRange, splitTranscriptParagraphs } from './TrackTranscript'

function fixture() {
  const clip = new Clip('source', 1, 100)
  clip.transcription = [
    { text: 'left', startSample: 0, endSample: 30 },
    { text: 'middle', startSample: 40, endSample: 60 },
    { text: 'right', startSample: 80, endSample: 100 },
  ]
  const track = new Track('track', 1)
  track.clipViews.push(new ClipView(clip, 20, 1000, 70), new ClipView(clip, 0, 2000, 100))
  return { clip, track }
}

const intervals = (track: Track) => getTrackTranscriptEntries(track).map((e) => [e.text, e.startSample, e.endSample])

test('trims clamp interactive bounds while repeated offscreen placements retain their occurrences', () => {
  const { track } = fixture()
  expect(intervals(track)).toEqual([
    ['left', 1000, 1010],
    ['middle', 1020, 1040],
    ['right', 1060, 1070],
    ['left', 2000, 2030],
    ['middle', 2040, 2060],
    ['right', 2080, 2100],
  ])
})

test('effective source length excludes wholly trimmed ranges and empty placements', () => {
  const { clip, track } = fixture()
  track.clipViews.splice(
    0,
    track.clipViews.length,
    new ClipView(clip, 90, 3000, 100),
    new ClipView(clip, 0, 4000, 0),
    new ClipView(clip, 60, 5000, 20),
  )
  expect(intervals(track)).toEqual([['right', 3000, 3010]])
})

test('half-open membership excludes gaps, touching boundaries and inverted ranges', () => {
  const { track } = fixture()
  const entries = getTrackTranscriptEntries(track)
  const selected = (start: number, end: number) => getTranscriptEntriesInRange(entries, start, end).map((e) => e.text)
  expect(selected(1010, 1020)).toEqual([])
  expect(selected(1020, 1040)).toEqual(['middle'])
  expect(selected(1005, 1025)).toEqual(['left', 'middle'])
  expect(selected(1020, 1020)).toEqual([])
  expect(selected(1040, 1020)).toEqual([])
})

test('overlapping placements retain deterministic occurrences and real phrase timing', () => {
  const { clip, track } = fixture()
  clip.transcription = [{ text: "all terrain, isn't it?", startSample: 40, endSample: 60 }]
  track.clipViews.splice(
    0,
    track.clipViews.length,
    new ClipView(clip, 0, 1000, 100),
    new ClipView(clip, 0, 1000, 100),
    new ClipView(clip, 0, 990, 100),
  )
  const entries = getTrackTranscriptEntries(track)
  expect(entries.map((e) => [e.placementIndex, e.text, e.startSample, e.endSample])).toEqual([
    [2, "all terrain, isn't it?", 1030, 1050],
    [0, "all terrain, isn't it?", 1040, 1060],
    [1, "all terrain, isn't it?", 1040, 1060],
  ])
})

test('blank atoms are omitted without normalizing persisted text', () => {
  const { clip, track } = fixture()
  clip.transcription = [
    { text: '  ', startSample: 0, endSample: 30 },
    { text: ' phrase! ', startSample: 40, endSample: 60 },
  ]
  expect(intervals(track)).toEqual([
    [' phrase! ', 1020, 1040],
    [' phrase! ', 2040, 2060],
  ])
})

test('silence trails the paragraph it follows while untranscribed speech keeps its VAD region', () => {
  const clip = new Clip('source', 1, 1_000)
  clip.transcription = [
    { text: '', startSample: 0, endSample: 100, kind: 'silence' },
    { text: 'first', startSample: 100, endSample: 200, speechStartSample: 100 },
    { text: '', startSample: 200, endSample: 300, kind: 'silence' },
    { text: 'same', startSample: 300, endSample: 400, speechStartSample: 100 },
    { text: '', startSample: 400, endSample: 600, kind: 'silence' },
    { text: '', startSample: 600, endSample: 700, speechStartSample: 600, kind: 'untranscribed' },
    { text: 'next', startSample: 800, endSample: 900, speechStartSample: 800 },
  ]
  const track = new Track('track', 1)
  track.clipViews.push(new ClipView(clip, 0, 0, 1_000))

  const paragraphs = splitTranscriptParagraphs(getTrackTranscriptEntries(track)).map((paragraph) =>
    paragraph.map((entry) => entry.kind ?? entry.text),
  )
  expect(paragraphs).toEqual([['silence'], ['first', 'silence', 'same', 'silence'], ['untranscribed'], ['next']])
})

test('ripple-deleted words sit at their seam inside their paragraph, and play nowhere in the crossfade', () => {
  const clip = new Clip('source', 1, 1_000)
  clip.transcription = [
    { text: 'one', startSample: 100, endSample: 300, speechStartSample: 100 },
    { text: 'um', startSample: 300, endSample: 400, speechStartSample: 100 },
    { text: 'two', startSample: 400, endSample: 600, speechStartSample: 100 },
    { text: '', startSample: 600, endSample: 1_000, kind: 'silence' },
  ]
  const track = new Track('track', 1)
  track.clipViews.push(...rippleDelete([new ClipView(clip, 0, 0, 1_000)], 300, 400, 10))

  expect(getTrackTranscriptEntries(track).map((e) => [e.kind ?? e.text, e.startSample, e.endSample])).toEqual([
    ['one', 100, 300],
    ['two', 300, 500],
    ['silence', 500, 900],
  ])
  const paragraphs = splitTranscriptParagraphs(getTrackTranscriptEntries(track, true)).map((paragraph) =>
    paragraph.map((e) => [e.kind ?? e.text, e.startSample, e.removed?.sourceStartSample ?? null]),
  )
  expect(paragraphs).toEqual([
    [
      ['one', 100, null],
      ['um', 300, 300],
      ['two', 300, null],
      ['silence', 500, null],
    ],
  ])
})
