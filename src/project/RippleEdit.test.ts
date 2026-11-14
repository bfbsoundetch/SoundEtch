import { expect, test } from 'vitest'
import { Clip } from './Clip'
import { ClipView } from './ClipView'
import { findRemovedAudio, restoreRemovedAudio, rippleDelete } from './RippleEdit'
import { Track } from './Track'

const CROSSFADE = 10

/** Fails unless a track accepts every placement: no instant may play three at once. */
function expectPlayable(clipViews: ClipView[]) {
  const track = new Track('check', 1)
  clipViews.forEach((clipView) => track.addClipView(clipView))
  expect(track.clipViews).toEqual(clipViews)
}

test('a ripple delete pulls later audio back and crossfades the join around the seam', () => {
  const clip = new Clip('take', 1, 1000)
  const after = new ClipView(clip, 0, 2000, 100)

  const result = rippleDelete([new ClipView(clip, 0, 0, 1000), after], 300, 400, CROSSFADE)

  expect(result).toEqual([
    new ClipView(clip, 0, 0, 310),
    new ClipView(clip, 390, 290, 610),
    new ClipView(clip, 0, 1900, 100),
  ])
  expectPlayable(result)
  expect(findRemovedAudio(result)).toEqual([
    { index: 0, seamSample: 300, sourceStartSample: 300, sourceEndSample: 400 },
  ])
})

test('restoring all removed audio rejoins the original placement', () => {
  const clip = new Clip('take', 1, 1000)
  const original = [new ClipView(clip, 0, 0, 1000), new ClipView(clip, 0, 2000, 100)]
  const deleted = rippleDelete(original, 300, 400, CROSSFADE)

  expect(restoreRemovedAudio(deleted, findRemovedAudio(deleted)[0], 300, 400, CROSSFADE)).toEqual(original)
})

test('restoring the middle of removed audio leaves both ends removed', () => {
  const clip = new Clip('take', 1, 1000)
  const deleted = rippleDelete([new ClipView(clip, 0, 0, 1000)], 300, 400, CROSSFADE)

  const result = restoreRemovedAudio(deleted, findRemovedAudio(deleted)[0], 320, 380, CROSSFADE)

  expectPlayable(result)
  expect(result[result.length - 1].getEndPosition()).toBe(960)
  expect(findRemovedAudio(result)).toEqual([
    { index: 0, seamSample: 300, sourceStartSample: 300, sourceEndSample: 320 },
    { index: 1, seamSample: 360, sourceStartSample: 380, sourceEndSample: 400 },
  ])
})

test('deleting audio that starts at a seam merges with the audio already removed there', () => {
  const clip = new Clip('take', 1, 1000)
  const earlier = new ClipView(new Clip('earlier', 1, 50), 0, 0, 50)
  const first = rippleDelete([earlier, new ClipView(clip, 0, 100, 1000)], 400, 500, CROSSFADE)

  // Both sides of the first join cross where this delete starts.
  const result = rippleDelete(first, 400, 450, CROSSFADE)

  expect(result[0]).toBe(earlier)
  expectPlayable(result)
  expect(findRemovedAudio(result)).toEqual([
    { index: 1, seamSample: 400, sourceStartSample: 300, sourceEndSample: 450 },
  ])
})

test('the join crossfade shrinks to stay clear of a neighbouring crossfade', () => {
  const clip = new Clip('take', 1, 1000)
  const previous = new ClipView(new Clip('previous', 1, 100), 0, 0, 100)
  const next = new ClipView(new Clip('next', 1, 100), 0, 1095, 100)

  // The previous clip crossfades into this one until 3 samples before the join.
  const result = rippleDelete([previous, new ClipView(clip, 0, 95, 1000), next], 103, 1045, CROSSFADE)

  expectPlayable(result)
  expect(result).toEqual([
    previous,
    new ClipView(clip, 0, 95, 11),
    new ClipView(clip, 947, 100, 53),
    new ClipView(next.clip, 0, 153, 100),
  ])
  expect(findRemovedAudio(result)).toEqual([{ index: 1, seamSample: 103, sourceStartSample: 8, sourceEndSample: 950 }])
})
