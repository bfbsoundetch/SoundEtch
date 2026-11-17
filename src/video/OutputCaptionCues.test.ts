import { expect, test } from 'vitest'
import { Clip } from '../project/Clip'
import { ClipView } from '../project/ClipView'
import { DEFAULT_OUTPUT_CAPTIONS, type OutputCaptionCue } from '../project/OutputCaptions'
import { Project } from '../project/Project'
import { Track } from '../project/Track'
import type { TranscribedRange } from '../project/Transcription'
import {
  buildOutputCaptionCues,
  findOutputCaptionCue,
  findOutputCaptionWord,
  resolveOutputCaptionTrack,
} from './OutputCaptionCues'

const RATE = 1000

function fixture(transcription: TranscribedRange[], length = 10_000) {
  const clip = new Clip('source', 1, length)
  clip.transcription = transcription
  const track = new Track('voice', 1)
  track.clipViews.push(new ClipView(clip, 0, 0, length))
  return { clip, track }
}

test('trims, offsets and repeated placements copy only their played word intervals', () => {
  const { clip, track } = fixture(
    [
      { text: 'left', startSample: 0, endSample: 30 },
      { text: 'middle', startSample: 40, endSample: 60 },
      { text: 'right', startSample: 80, endSample: 100 },
    ],
    100,
  )
  track.clipViews.splice(
    0,
    1,
    new ClipView(clip, 20, 1000, 70),
    new ClipView(clip, 0, 2000, 100),
    new ClipView(clip, 0, 3000, 0),
    new ClipView(clip, 60, 4000, 20),
  )
  const cues = buildOutputCaptionCues(track, RATE)
  expect(cues.flatMap((cue) => cue.words.map((word) => [word.startSample, word.endSample]))).toEqual([
    [1000, 1010],
    [1020, 1040],
    [1060, 1070],
    [2000, 2030],
    [2040, 2060],
    [2080, 2100],
  ])
  expect(findOutputCaptionCue(cues, 999)).toBeNull()
  expect(findOutputCaptionCue(cues, 1070)).toBeNull()
  expect(findOutputCaptionCue(cues, 2100)).toBeNull()
  // A rendered/exported snapshot retains neither editable ranges nor clip-view references.
  clip.transcription = [{ text: 'changed', startSample: 0, endSample: 100 }]
  track.clipViews.length = 0
  expect(cues[0].words[0]).toEqual({ text: 'Left', startSample: 1000, endSample: 1010 })
})

test('seeks use half-open boundaries and a short internal pause has no highlighted word', () => {
  const { track } = fixture([
    { text: 'hello', startSample: 100, endSample: 200 },
    { text: 'there', startSample: 300, endSample: 400 },
    { text: 'again?', startSample: 400, endSample: 500 },
  ])
  const cues = buildOutputCaptionCues(track, RATE)
  expect(cues).toHaveLength(1)
  expect(cues[0].words.map((word) => word.text)).toEqual(['Hello', 'there', 'again?'])
  for (const [sample, index] of [
    [400, 2],
    [100, 0],
    [200, -1],
    [300, 1],
    [299, -1],
    [499, 2],
    [199, 0],
  ]) {
    expect(findOutputCaptionCue(cues, sample)).toBe(cues[0])
    expect(findOutputCaptionWord(cues[0], sample)).toBe(index)
  }
  expect(findOutputCaptionCue(cues, 99)).toBeNull()
  expect(findOutputCaptionCue(cues, 500)).toBeNull()
  expect(findOutputCaptionWord(cues[0], 500)).toBe(-1)
})

test('long pauses, untranscribed gaps and paragraph boundaries never bridge captions', () => {
  const { track } = fixture([
    { text: 'one', startSample: 0, endSample: 100, speechStartSample: 0 },
    { text: '', startSample: 100, endSample: 701, kind: 'silence' },
    { text: 'two', startSample: 701, endSample: 800, speechStartSample: 0 },
    { text: '', startSample: 800, endSample: 850, kind: 'untranscribed', speechStartSample: 0 },
    { text: 'three', startSample: 850, endSample: 950, speechStartSample: 0 },
    { text: 'four', startSample: 950, endSample: 1000, speechStartSample: 950 },
  ])
  const cues = buildOutputCaptionCues(track, RATE)
  expect(cues.map((cue) => [cue.startSample, cue.endSample])).toEqual([
    [0, 100],
    [701, 800],
    [850, 950],
    [950, 1000],
  ])
  expect(cues.flatMap((cue) => cue.words.map((word) => word.text))).toEqual(['One,', 'two', 'three.', 'Four.'])
  for (const sample of [100, 400, 700, 800, 849, 1000]) expect(findOutputCaptionCue(cues, sample)).toBeNull()
  expect(findOutputCaptionCue(cues, 950)).toBe(cues[3])
})

test('fragments respect punctuation, seven words and character limits without dropping long words', () => {
  const { track } = fixture(
    'a b c d e f g h'
      .split(' ')
      .map((text, index) => ({ text, startSample: index * 100, endSample: (index + 1) * 100 })),
  )
  expect(buildOutputCaptionCues(track, RATE).map((cue) => cue.words.length)).toEqual([7, 1])

  const lengthy = fixture(
    ['abcdefghij', 'abcdefghij', 'abcdefghij', 'abcdefghij', 'extraordinarilylongword'.repeat(3)].map(
      (text, index) => ({
        text,
        startSample: index * 100,
        endSample: (index + 1) * 100,
      }),
    ),
  )
  expect(buildOutputCaptionCues(lengthy.track, RATE).map((cue) => cue.words.length)).toEqual([3, 1, 1])

  const edited = fixture([{ text: 'Keep NASA, exactly! Final words', startSample: 100, endSample: 600 }])
  const cues = buildOutputCaptionCues(edited.track, RATE)
  expect(cues.map((cue) => cue.words.map((word) => word.text).join(' '))).toEqual([
    'Keep NASA,',
    'exactly!',
    'Final words.',
  ])
  expect(cues.flatMap((cue) => cue.words.map((word) => [word.startSample, word.endSample]))).toEqual([
    [100, 200],
    [200, 300],
    [300, 400],
    [400, 500],
    [500, 600],
  ])
})

test('overlapping cues and words deterministically resume earlier intervals after shorter ones end', () => {
  const words = [
    { text: 'long', startSample: 0, endSample: 1000 },
    { text: 'short', startSample: 100, endSample: 200 },
    { text: 'later', startSample: 100, endSample: 300 },
  ]
  const outer: OutputCaptionCue = { startSample: 0, endSample: 1000, words }
  const inner: OutputCaptionCue = {
    startSample: 400,
    endSample: 500,
    words: [{ text: 'inner', startSample: 400, endSample: 500 }],
  }
  const cues = [outer, inner]
  expect(findOutputCaptionWord(outer, 99)).toBe(0)
  expect(findOutputCaptionWord(outer, 100)).toBe(2)
  expect(findOutputCaptionWord(outer, 299)).toBe(2)
  expect(findOutputCaptionWord(outer, 300)).toBe(0)
  expect(findOutputCaptionCue(cues, 400)).toBe(inner)
  expect(findOutputCaptionCue(cues, 500)).toBe(outer)
  expect(findOutputCaptionCue(cues, 999)).toBe(outer)
  expect(findOutputCaptionCue(cues, 1000)).toBeNull()
})

test('automatic selection uses audible played words; manual selection permits muted members only', () => {
  const project = new Project('captions', RATE)
  const automatic = { ...DEFAULT_OUTPUT_CAPTIONS, followLoudest: false }
  const unrecognized = fixture([{ text: '', startSample: 0, endSample: 100, kind: 'untranscribed' }]).track
  const trimmed = fixture([{ text: 'trimmed', startSample: 0, endSample: 100 }]).track
  trimmed.clipViews.splice(0, 1, new ClipView(trimmed.clipViews[0].clip, 100, 0, 100))
  const muted = fixture([{ text: 'muted', startSample: 0, endSample: 100 }]).track
  const audible = fixture([{ text: 'audible', startSample: 0, endSample: 100 }]).track
  for (const track of [unrecognized, trimmed, muted, audible]) project.addTrack(track)
  project.setTrackMuted(muted, true)
  expect(resolveOutputCaptionTrack(project, automatic)).toBe(audible)
  expect(resolveOutputCaptionTrack(project, { ...automatic, track: muted })).toBe(muted)
  expect(resolveOutputCaptionTrack(project, { ...automatic, track: trimmed })).toBeNull()
  const outsider = fixture([{ text: 'outside', startSample: 0, endSample: 100 }]).track
  expect(resolveOutputCaptionTrack(project, { ...automatic, track: outsider })).toBeNull()
  project.setTrackSoloed(unrecognized, true)
  expect(resolveOutputCaptionTrack(project, automatic)).toBeNull()
  project.setTrackSoloed(unrecognized, false)
  project.setTrackSoloed(muted, true)
  project.setTrackMuted(muted, false)
  expect(resolveOutputCaptionTrack(project, automatic)).toBe(muted)
})
