import { expect, test } from 'vitest'
import { Clip } from './Clip'
import { ClipView } from './ClipView'
import {
  findRemovedAudio,
  moveTimelineRange,
  reopenRippleGap,
  restoreRemovedAudio,
  rippleDelete,
  shiftTimelineAfter,
} from './TimelineEdit'
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

test('moving a range cuts it and pastes it elsewhere on its track, leaving silence behind', () => {
  const clip = new Clip('take', 1, 1000)
  const track = new Track('track', 1)
  track.clipViews.push(new ClipView(clip, 0, 0, 1000))

  const layouts = moveTimelineRange([track], [track], 200, 300, 900, 0)

  expect(layouts).toEqual(
    new Map([
      [track, [new ClipView(clip, 0, 0, 200), new ClipView(clip, 300, 300, 700), new ClipView(clip, 200, 1100, 100)]],
    ]),
  )
})

test('moving a range a little crossfades it with the audio it lands on', () => {
  const clip = new Clip('take', 1, 1000)
  const track = new Track('track', 1)
  track.clipViews.push(new ClipView(clip, 0, 0, 1000))

  const result = moveTimelineRange([track], [track], 200, 300, 50, 0)!.get(track)!

  expectPlayable(result)
  expect(result).toEqual([
    new ClipView(clip, 0, 0, 200),
    new ClipView(clip, 200, 250, 100),
    new ClipView(clip, 300, 300, 700),
  ])
})

test('moving ranges down the track list lets a track take audio into the range it gave up', () => {
  const tracks = [0, 1, 2].map((index) => new Track(`Track ${index}`, 1))
  const clips = tracks.map((track) => new Clip(track.name, 1, 100))
  // The third track's clip starts inside the moved range, so the audio partly overlaps it.
  tracks.forEach((track, index) => track.clipViews.push(new ClipView(clips[index], 0, index == 2 ? 50 : 0, 100)))

  const layouts = moveTimelineRange(tracks, tracks.slice(0, 2), 40, 60, 0, 1)!

  expect(layouts.get(tracks[0])).toEqual([new ClipView(clips[0], 0, 0, 40), new ClipView(clips[0], 60, 60, 40)])
  expect(layouts.get(tracks[1])).toEqual([
    new ClipView(clips[1], 0, 0, 40),
    new ClipView(clips[0], 40, 40, 20),
    new ClipView(clips[1], 60, 60, 40),
  ])
  expect(layouts.get(tracks[2])).toEqual([new ClipView(clips[1], 40, 40, 20), new ClipView(clips[2], 0, 50, 100)])
})

test('a move is refused where it would play three clips at once or meet another channel count', () => {
  const source = new Track('source', 1)
  const crowded = new Track('crowded', 1)
  const stereo = new Track('stereo', 2)
  const clip = new Clip('take', 1, 100)
  source.clipViews.push(new ClipView(clip, 0, 0, 100))
  crowded.clipViews.push(new ClipView(clip, 0, 0, 60), new ClipView(clip, 0, 50, 50))

  expect(moveTimelineRange([source, crowded], [source], 40, 70, 0, 1)).toBeNull()
  expect(moveTimelineRange([source, stereo], [source], 0, 10, 0, 1)).toBeNull()
  expect(moveTimelineRange([source], [source], 10, 20, -20, 0)).toBeNull()
})

test('a move is refused where the audio would play entirely within a clip or around one', () => {
  const clip = new Clip('take', 1, 1000)
  const source = new Track('source', 1)
  const target = new Track('target', 1)
  source.clipViews.push(new ClipView(clip, 0, 0, 1000))
  target.clipViews.push(new ClipView(clip, 0, 100, 300))

  expect(moveTimelineRange([source, target], [source], 150, 250, 0, 1)).toBeNull()
  expect(moveTimelineRange([source, target], [source], 100, 400, 0, 1)).toBeNull()
  expect(moveTimelineRange([source, target], [source], 50, 450, 0, 1)).toBeNull()
  expect(moveTimelineRange([source], [source], 200, 300, -150, 0)).toBeNull()
  expect(moveTimelineRange([source, target], [source], 300, 500, 0, 1)).not.toBeNull()
})

test('shifting a track without cutting it moves only the audio after the cut, where it fits', () => {
  const clip = new Clip('take', 1, 1000)
  const before = new ClipView(clip, 0, 0, 100)
  const after = new ClipView(clip, 200, 500, 100)

  expect(shiftTimelineAfter([before, after], 300, -200)).toEqual([before, new ClipView(clip, 200, 300, 100)])
  // Audio across the cut's end could only stay in sync by being cut.
  expect(shiftTimelineAfter([new ClipView(clip, 0, 0, 400)], 300, -200)).toBeNull()
  // Pulled back, the later audio would play entirely within audio that stays.
  expect(shiftTimelineAfter([new ClipView(clip, 0, 0, 290), new ClipView(clip, 0, 300, 50)], 300, -200)).toBeNull()
})

test('reopening a ripple gap puts back the audio each track removed there, or silence where it removed none', () => {
  const take = new Clip('take', 1, 1000)
  const original = [new ClipView(take, 0, 0, 1000)]
  const cut = rippleDelete(original, 300, 400, CROSSFADE)

  expect(reopenRippleGap(cut, 300, 0, 100, CROSSFADE)).toEqual(original)
  expect(reopenRippleGap(cut, 300, 20, 60, CROSSFADE)).toEqual(
    restoreRemovedAudio(cut, findRemovedAudio(cut)[0], 320, 380, CROSSFADE),
  )
  // More than this track removed at the seam.
  expect(reopenRippleGap(cut, 300, 50, 100, CROSSFADE)).toBeNull()

  const later = new Clip('later', 1, 100)
  const gap = [new ClipView(take, 0, 0, 300), new ClipView(later, 0, 300, 100)]
  expect(reopenRippleGap(gap, 300, 0, 100, CROSSFADE)).toEqual([gap[0], new ClipView(later, 0, 400, 100)])
  // Audio playing straight across the seam removed nothing there, so it cannot take any back in sync.
  expect(reopenRippleGap(original, 300, 0, 100, CROSSFADE)).toBeNull()
})
