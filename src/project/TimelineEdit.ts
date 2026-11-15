import { ClipView, cloneClipViewWithNewStartPosition } from './ClipView'
import type { Track } from './Track'

/** A track as a timeline edit sees it. */
type TrackLayout = Pick<Track, 'clipViews' | 'getChannelCount'>

/** Length of the crossfade a ripple edit puts over each join it makes. */
export const RIPPLE_CROSSFADE_MS = 30

/** How far each side of a ripple join plays into the other: half the crossfade. */
export function rippleCrossfadeSamples(sampleRate: number): number {
  return Math.round((sampleRate * RIPPLE_CROSSFADE_MS) / 2000)
}

/** Clip source audio skipped where one placement of a clip hands over to the next placement of that clip. */
export interface RemovedAudio {
  /** The placement playing up to the seam; the next placement plays on from it. */
  readonly index: number
  /** Timeline sample of the seam. */
  readonly seamSample: number
  readonly sourceStartSample: number
  readonly sourceEndSample: number
}

/**
 * The timeline sample where playback hands over from `before` to the later placement `after`: where
 * they meet, or the middle of their crossfade. Null unless `after` starts inside or at the end of
 * `before` and outlasts it.
 */
export function findSeam(before: ClipView, after: ClipView): number | null {
  const end = before.getEndPosition()
  if (after.startPosition <= before.startPosition || after.startPosition > end || after.getEndPosition() <= end) {
    return null
  }
  return after.startPosition + Math.floor((end - after.startPosition) / 2)
}

/** Every seam between consecutive placements of one clip that skips ahead in its source. */
export function findRemovedAudio(clipViews: readonly ClipView[]): RemovedAudio[] {
  const removed: RemovedAudio[] = []
  for (let index = 0; index + 1 < clipViews.length; ++index) {
    const before = clipViews[index]
    const after = clipViews[index + 1]
    const seamSample = before.clip === after.clip ? findSeam(before, after) : null
    if (seamSample === null) continue
    const sourceStartSample = before.offset + seamSample - before.startPosition
    const sourceEndSample = after.offset + seamSample - after.startPosition
    if (sourceStartSample < sourceEndSample) removed.push({ index, seamSample, sourceStartSample, sourceEndSample })
  }
  return removed
}

/** Copies of the parts of `clipViews` inside timeline samples [start, end), where they play. */
export function sliceTimelineRange(clipViews: readonly ClipView[], start: number, end: number): ClipView[] {
  return clipViews.flatMap((clipView) => {
    const sliceStart = Math.max(start, clipView.startPosition)
    const sliceEnd = Math.min(end, clipView.getEndPosition())
    if (sliceStart >= sliceEnd) {
      return []
    }
    return [
      new ClipView(
        clipView.clip,
        clipView.offset + sliceStart - clipView.startPosition,
        sliceStart,
        sliceEnd - sliceStart,
      ),
    ]
  })
}

/**
 * Whether `newClipView` can join `clipViews`, sorted by start: it may partly overlap clips, for a
 * crossfade, but no instant may play three clips, and neither it nor a clip it overlaps may play
 * entirely within the other, which playback would crossfade into and then cut off at its end.
 */
export function canPlaceClipView(clipViews: readonly ClipView[], newClipView: ClipView): boolean {
  let latestOverlapEnd = -Infinity
  for (const clipView of clipViews) {
    const overlapStart = Math.max(clipView.startPosition, newClipView.startPosition)
    const overlapEnd = Math.min(clipView.getEndPosition(), newClipView.getEndPosition())
    if (overlapStart >= overlapEnd) {
      continue
    }
    if (
      overlapStart < latestOverlapEnd ||
      overlapEnd - overlapStart === newClipView.length ||
      overlapEnd - overlapStart === clipView.length
    ) {
      return false
    }
    latestOverlapEnd = Math.max(latestOverlapEnd, overlapEnd)
  }
  return true
}

/**
 * What remains of `clipViews` once timeline samples [start, end) are cut out, without moving anything,
 * sorted by start. Where several placements cross an edge, only the one reaching furthest beyond it
 * keeps that side. Placements the cut does not touch are returned as they are.
 */
export function removeTimelineRange(clipViews: readonly ClipView[], start: number, end: number): ClipView[] {
  const crossingStart = clipViews.filter((clipView) => crosses(clipView, start))
  const crossingEnd = clipViews.filter((clipView) => crosses(clipView, end))
  const keepLeft = crossingStart.reduce<ClipView | null>(
    (earliest, clipView) => (earliest == null || clipView.startPosition < earliest.startPosition ? clipView : earliest),
    null,
  )
  const keepRight = crossingEnd.reduce<ClipView | null>(
    (latest, clipView) => (latest == null || clipView.getEndPosition() > latest.getEndPosition() ? clipView : latest),
    null,
  )

  return clipViews
    .flatMap((clipView) => {
      const clipViewEnd = clipView.getEndPosition()
      if (clipViewEnd <= start || clipView.startPosition >= end) {
        return [clipView]
      }
      const fragments = new Array<ClipView>()
      if (clipView.startPosition < start && (crossingStart.length < 2 || clipView == keepLeft)) {
        fragments.push(
          new ClipView(clipView.clip, clipView.offset, clipView.startPosition, start - clipView.startPosition),
        )
      }
      if (clipViewEnd > end && (crossingEnd.length < 2 || clipView == keepRight)) {
        const fragmentStart = Math.max(end, clipView.startPosition)
        fragments.push(
          new ClipView(
            clipView.clip,
            clipView.offset + fragmentStart - clipView.startPosition,
            fragmentStart,
            clipViewEnd - fragmentStart,
          ),
        )
      }
      return fragments
    })
    .sort((a, b) => a.startPosition - b.startPosition)
}

/**
 * The clip views each changed track ends up with when timeline samples [start, end) of `selected`
 * move `shift` samples along and `trackOffset` places through `tracks`, as cutting and pasting them
 * would: the source range is left empty, and moved audio may crossfade with a clip it partly overlaps.
 * Null when moved audio would start before the timeline, land off the track list or on a track with
 * another channel count, make three clips play at once, or play entirely within or around a clip.
 */
export function moveTimelineRange<T extends TrackLayout>(
  tracks: readonly T[],
  selected: readonly T[],
  start: number,
  end: number,
  shift: number,
  trackOffset: number,
): Map<T, ClipView[]> | null {
  const layouts = new Map<T, ClipView[]>()
  if (shift === 0 && trackOffset === 0) {
    return layouts
  }
  if (start + shift < 0) {
    return null
  }
  const moves = new Array<{ target: T | undefined; pieces: ClipView[] }>()
  for (const track of selected) {
    const pieces = sliceTimelineRange(track.clipViews, start, end)
    if (pieces.length === 0) continue
    // Every source is cut before anything is pasted, so audio can land in a range just vacated.
    layouts.set(track, removeTimelineRange(track.clipViews, start, end))
    const index = tracks.indexOf(track)
    moves.push({
      target: index < 0 ? undefined : tracks[index + trackOffset],
      pieces: pieces.map((piece) => cloneClipViewWithNewStartPosition(piece, shift)),
    })
  }
  for (const { target, pieces } of moves) {
    if (!target) {
      return null
    }
    const clipViews = layouts.get(target) ?? target.clipViews.slice()
    for (const piece of pieces) {
      if (piece.clip.getChannelCount() !== target.getChannelCount() || !canPlaceClipView(clipViews, piece)) {
        return null
      }
      insertByStart(clipViews, piece)
    }
    layouts.set(target, clipViews)
  }
  return layouts
}

/**
 * `clipViews` with every placement starting at or after `from` moved `shift` samples along, as a ripple
 * cut on other tracks pulls this track's later audio back without cutting it. Null when a placement
 * plays across `from`, so it could only stay in sync by being cut, or when moved audio would start
 * before the timeline or not fit beside the audio that stays (see `canPlaceClipView`).
 */
export function shiftTimelineAfter(clipViews: readonly ClipView[], from: number, shift: number): ClipView[] | null {
  if (clipViews.some((clipView) => crosses(clipView, from))) {
    return null
  }
  const result = clipViews.filter((clipView) => clipView.startPosition < from)
  for (const clipView of clipViews) {
    if (clipView.startPosition < from) continue
    const moved = cloneClipViewWithNewStartPosition(clipView, shift)
    if (moved.startPosition < 0 || !canPlaceClipView(result, moved)) {
      return null
    }
    insertByStart(result, moved)
  }
  return result
}

/** Inserts `clipView` into `clipViews`, keeping them sorted by start. */
export function insertByStart(clipViews: ClipView[], clipView: ClipView): void {
  const index = clipViews.findIndex((placed) => placed.startPosition > clipView.startPosition)
  clipViews.splice(index < 0 ? clipViews.length : index, 0, clipView)
}

/**
 * Cuts timeline samples [start, end) out of `clipViews` and pulls everything after them back by
 * their length. Where the cut goes through audio on both sides, the two sides overlap by up to
 * `crossfade` samples each way around the join, so playback crossfades over it.
 */
export function rippleDelete(
  clipViews: readonly ClipView[],
  start: number,
  end: number,
  crossfade: number,
): ClipView[] {
  const length = end - start
  const remaining = removeTimelineRange(clipViews, start, end).map((clipView) =>
    clipView.startPosition >= end ? cloneClipViewWithNewStartPosition(clipView, -length) : clipView,
  )
  const cutsBothSides =
    clipViews.some((clipView) => crosses(clipView, start)) && clipViews.some((clipView) => crosses(clipView, end))
  return cutsBothSides ? crossfadeJoin(remaining, start, crossfade) : remaining
}

/**
 * Plays clip source [sourceStart, sourceEnd) of `removed` again at its seam, pushing everything after
 * the seam back by its length. Joins that remain crossfade as `rippleDelete`'s do.
 */
export function restoreRemovedAudio(
  clipViews: readonly ClipView[],
  removed: RemovedAudio,
  sourceStart: number,
  sourceEnd: number,
  crossfade: number,
): ClipView[] {
  const before = clipViews[removed.index]
  const after = clipViews[removed.index + 1]
  const start = Math.max(sourceStart, removed.sourceStartSample)
  const end = Math.min(sourceEnd, removed.sourceEndSample)
  if (start >= end) {
    return clipViews.slice()
  }

  // The source runs that play end to end from where `before` starts, without the old crossfade.
  const runs: Array<[number, number]> = [[before.offset, removed.sourceStartSample]]
  if (start === removed.sourceStartSample) {
    runs[0][1] = end
  } else {
    runs.push([start, end])
  }
  const afterSourceEnd = after.offset + after.length
  if (end === removed.sourceEndSample) {
    runs[runs.length - 1][1] = afterSourceEnd
  } else {
    runs.push([removed.sourceEndSample, afterSourceEnd])
  }

  const joins = new Array<number>()
  let position = before.startPosition
  const restored = runs.map(([runStart, runEnd], index) => {
    if (index > 0) joins.push(position)
    const clipView = new ClipView(before.clip, runStart, position, runEnd - runStart)
    position += runEnd - runStart
    return clipView
  })
  let result = [
    ...clipViews.slice(0, removed.index),
    ...restored,
    ...clipViews.slice(removed.index + 2).map((clipView) => cloneClipViewWithNewStartPosition(clipView, end - start)),
  ]
  for (const join of joins) {
    result = crossfadeJoin(result, join, crossfade)
  }
  return result
}

/**
 * `clipViews` with `length` samples put back at the ripple seam `at`: the audio a ripple edit removed
 * there, from `offset` samples into it, or silence where it removed none, by pushing everything from
 * `at` on later. Null when too little audio was removed there, or audio plays across `at` without
 * having had any removed there.
 */
export function reopenRippleGap(
  clipViews: readonly ClipView[],
  at: number,
  offset: number,
  length: number,
  crossfade: number,
): ClipView[] | null {
  const removed = findRemovedAudio(clipViews).find((audio) => audio.seamSample === at)
  if (!removed) {
    return shiftTimelineAfter(clipViews, at, length)
  }
  const start = removed.sourceStartSample + offset
  if (offset < 0 || start + length > removed.sourceEndSample) {
    return null
  }
  return restoreRemovedAudio(clipViews, removed, start, start + length, crossfade)
}

/**
 * Overlaps the placement ending at `join` with the one starting there by up to `crossfade` samples
 * each way, as far as their sources allow. Each keeps at least half of its own length clear of the
 * crossfade, which stays clear of every other placement.
 */
function crossfadeJoin(clipViews: ClipView[], join: number, crossfade: number): ClipView[] {
  const beforeIndex = clipViews.findIndex(
    (clipView) => clipView.startPosition < join && clipView.getEndPosition() === join,
  )
  const afterIndex = clipViews.findIndex(
    (clipView) => clipView.startPosition === join && clipView.getEndPosition() > join,
  )
  if (beforeIndex < 0 || afterIndex < 0) {
    return clipViews
  }
  const before = clipViews[beforeIndex]
  const after = clipViews[afterIndex]
  let overlap = Math.min(
    crossfade,
    Math.floor(before.length / 2),
    Math.floor(after.length / 2),
    before.clip.length - before.offset - before.length,
    after.offset,
  )
  clipViews.forEach((clipView, index) => {
    if (index === beforeIndex || index === afterIndex) return
    const distance =
      clipView.getEndPosition() <= join
        ? join - clipView.getEndPosition()
        : clipView.startPosition >= join
          ? clipView.startPosition - join
          : 0
    overlap = Math.min(overlap, distance)
  })
  if (overlap <= 0) {
    return clipViews
  }
  const result = clipViews.slice()
  result[beforeIndex] = new ClipView(before.clip, before.offset, before.startPosition, before.length + overlap)
  result[afterIndex] = new ClipView(after.clip, after.offset - overlap, join - overlap, after.length + overlap)
  return result.sort((a, b) => a.startPosition - b.startPosition)
}

/** Whether `sample` falls strictly inside `clipView`. */
function crosses(clipView: ClipView, sample: number): boolean {
  return clipView.startPosition < sample && sample < clipView.getEndPosition()
}
