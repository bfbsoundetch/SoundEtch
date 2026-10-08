import { Clip } from '../project/Clip'
import { ClipView } from '../project/ClipView'
import { Track } from '../project/Track'
import {
  getSelectedClipIntervals,
  replaceTranscriptionRanges,
  transcriptionRangesEqual,
} from './TranscriptionSelection'

function trackWithViews(...clipViews: ClipView[]): Track {
  const track = new Track('track', 1)
  clipViews.forEach((clipView) => track.addClipView(clipView))
  return track
}

test('selection maps partial ClipView intersections to clip-source samples across gaps and half-open boundaries', () => {
  const first = new Clip('first', 1, 1_000)
  const second = new Clip('second', 1, 1_000)
  const track = trackWithViews(new ClipView(first, 100, 200, 300), new ClipView(second, 0, 600, 100))

  expect(getSelectedClipIntervals({ startSample: 250, endSample: 600, tracks: [track] })).toEqual([
    { clip: first, startSample: 150, endSample: 400 },
  ])
  expect(getSelectedClipIntervals({ startSample: 500, endSample: 600, tracks: [track] })).toEqual([])
  expect(getSelectedClipIntervals({ startSample: 600, endSample: 700, tracks: [track] })).toEqual([
    { clip: second, startSample: 0, endSample: 100 },
  ])
})

test('selection merges overlapping and adjacent source intervals from repeated placements on multiple tracks', () => {
  const repeated = new Clip('repeated', 1, 1_000)
  const independent = new Clip('independent', 1, 1_000)
  const tracks = [
    trackWithViews(new ClipView(repeated, 0, 0, 100)),
    trackWithViews(new ClipView(repeated, 100, 0, 100)),
    trackWithViews(new ClipView(repeated, 50, 0, 100)),
    trackWithViews(new ClipView(independent, 20, 50, 100)),
  ]

  expect(getSelectedClipIntervals({ startSample: 25, endSample: 125, tracks })).toEqual([
    { clip: repeated, startSample: 25, endSample: 200 },
    { clip: independent, startSample: 20, endSample: 95 },
  ])
})

test('selection keeps disjoint source intervals for one clip separate', () => {
  const clip = new Clip('source gaps', 1, 1_000)
  const tracks = [trackWithViews(new ClipView(clip, 0, 0, 100)), trackWithViews(new ClipView(clip, 300, 0, 100))]

  expect(getSelectedClipIntervals({ startSample: 0, endSample: 100, tracks })).toEqual([
    { clip, startSample: 0, endSample: 100 },
    { clip, startSample: 300, endSample: 400 },
  ])
})

test('replacement removes every intersecting old word, preserves outside objects, and sorts generated words', () => {
  const before = { text: 'before', startSample: 0, endSample: 10 }
  const leftStraddle = { text: 'left straddle', startSample: 5, endSample: 12 }
  const inside = { text: 'inside', startSample: 12, endSample: 18 }
  const rightStraddle = { text: 'right straddle', startSample: 18, endSample: 35 }
  const after = { text: 'after', startSample: 30, endSample: 40 }
  const generatedLater = { text: 'later', startSample: 24, endSample: 28 }
  const generatedEarlier = { text: 'earlier', startSample: 14, endSample: 17 }

  const result = replaceTranscriptionRanges(
    [before, leftStraddle, inside, rightStraddle, after],
    [{ startSample: 10, endSample: 30, ranges: [generatedLater, generatedEarlier] }],
  )

  expect(result).toEqual([before, generatedEarlier, generatedLater, after])
  expect(result[0]).toBe(before)
  expect(result[3]).toBe(after)
})

test('an empty successful replacement clears stale text only in its interval', () => {
  const current = [
    { text: 'before', startSample: 0, endSample: 10 },
    { text: 'clear', startSample: 10, endSample: 20 },
    { text: 'after', startSample: 20, endSample: 30 },
  ]

  expect(replaceTranscriptionRanges(current, [{ startSample: 10, endSample: 20, ranges: [] }])).toEqual([
    current[0],
    current[2],
  ])
})

test('replacement sorting is stable by start and end sample and equality is value-based', () => {
  const current = [{ text: 'same', startSample: 0, endSample: 5 }]
  const equalCopy = [{ ...current[0] }]
  const result = replaceTranscriptionRanges(
    [
      { text: 'long', startSample: 5, endSample: 15 },
      { text: 'first tie', startSample: 1, endSample: 5 },
      { text: 'short', startSample: 5, endSample: 10 },
      { text: 'second tie', startSample: 1, endSample: 5 },
    ],
    [],
  )

  expect(result.map((range) => range.text)).toEqual(['first tie', 'second tie', 'short', 'long'])
  expect(transcriptionRangesEqual(current, equalCopy)).toBe(true)
})
