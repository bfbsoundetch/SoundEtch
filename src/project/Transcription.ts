/** Audio without a recognized word: quiet audio, or sound the VAD supports but Granite did not transcribe. */
export type TranscriptGapKind = 'silence' | 'untranscribed'

export interface TranscribedRange {
  /** Recognized words; empty for gaps. */
  readonly text: string
  readonly startSample: number
  readonly endSample: number
  /** Unpadded VAD-region onset in clip source samples, shared by its words. */
  readonly speechStartSample?: number
  /** Absent on recognized words. */
  readonly kind?: TranscriptGapKind
}

export interface TranscriptBoundaryLimits {
  /** The clip source samples a placement plays; ranges outside them stay put. */
  readonly minimumSample: number
  readonly maximumSample: number
  /**
   * The narrowest interval a move may leave, in samples: edges this close move together, the
   * boundary snaps onto a limit this close, and a word keeps at least this much played audio.
   */
  readonly tolerance: number
}

/** The played range edges that move together as one boundary, and how far they can go. */
export interface TranscriptBoundary {
  /** Index of the range ending at the boundary, or -1. */
  readonly ending: number
  /** Index of the range starting at the boundary, or -1. */
  readonly starting: number
  readonly lowestSample: number
  readonly highestSample: number
}

export interface MovedTranscriptBoundary {
  readonly ranges: TranscribedRange[]
  /** Where the boundary landed after clamping and snapping. */
  readonly sample: number
}

/**
 * The boundary formed by the played range edges at `sample`: it moves between its neighbours'
 * edges, and a gap may shrink to nothing while a word keeps the tolerance. Null when no played
 * range has an edge at `sample`.
 */
export function findTranscriptBoundary(
  ranges: readonly TranscribedRange[],
  sample: number,
  limits: TranscriptBoundaryLimits,
): TranscriptBoundary | null {
  const { minimumSample, maximumSample, tolerance } = limits
  if (
    ![sample, minimumSample, maximumSample, tolerance].every(Number.isSafeInteger) ||
    tolerance < 0 ||
    sample < minimumSample ||
    sample > maximumSample
  ) {
    return null
  }
  const played = (index: number) =>
    index >= 0 &&
    index < ranges.length &&
    ranges[index].startSample < maximumSample &&
    ranges[index].endSample > minimumSample
  // The first range starting at or after the boundary.
  let next = 0
  let high = ranges.length
  while (next < high) {
    const middle = (next + high) >>> 1
    if (ranges[middle].startSample < sample) next = middle + 1
    else high = middle
  }
  const previous = next - 1
  let ending = played(previous) && ranges[previous].endSample === sample ? previous : -1
  let starting = played(next) && ranges[next].startSample === sample ? next : -1
  // Edges closer than the tolerance read as one boundary; moving it closes the unlabeled sliver.
  if (
    ending < 0 &&
    starting >= 0 &&
    played(previous) &&
    ranges[previous].endSample <= sample &&
    sample - ranges[previous].endSample <= tolerance
  ) {
    ending = previous
  } else if (starting < 0 && ending >= 0 && played(next) && ranges[next].startSample - sample <= tolerance) {
    starting = next
  }
  if (ending < 0 && starting < 0) {
    return null
  }

  const wordLength = Math.max(1, tolerance)
  let lowest: number
  if (ending >= 0) {
    const range = ranges[ending]
    lowest =
      range.kind === undefined
        ? Math.min(range.endSample, Math.max(range.startSample, minimumSample) + wordLength)
        : range.startSample
  } else {
    lowest = previous >= 0 ? ranges[previous].endSample : minimumSample
  }
  let highest: number
  if (starting >= 0) {
    const range = ranges[starting]
    highest =
      range.kind === undefined
        ? Math.max(range.startSample, Math.min(range.endSample, maximumSample) - wordLength)
        : range.endSample
  } else {
    highest = next < ranges.length ? ranges[next].startSample : maximumSample
  }
  return {
    ending,
    starting,
    lowestSample: Math.max(lowest, minimumSample),
    highestSample: Math.min(highest, maximumSample),
  }
}

/**
 * Moves the boundary at `sample` toward `target`, snapping onto the limit it approaches when
 * within the tolerance. A gap moved to zero length is removed, and silences left touching merge.
 * Null when there is no boundary at `sample` or nothing would change.
 */
export function moveTranscriptBoundary(
  ranges: readonly TranscribedRange[],
  sample: number,
  target: number,
  limits: TranscriptBoundaryLimits,
): MovedTranscriptBoundary | null {
  const boundary = Number.isSafeInteger(target) ? findTranscriptBoundary(ranges, sample, limits) : null
  if (!boundary) {
    return null
  }
  const { ending, starting, lowestSample, highestSample } = boundary
  let position = Math.max(lowestSample, Math.min(highestSample, target))
  // Snap onto a limit ahead rather than leave an invisible sliver before it.
  if (position > sample && highestSample - position <= limits.tolerance) position = highestSample
  else if (position < sample && position - lowestSample <= limits.tolerance) position = lowestSample
  if (
    (ending < 0 || ranges[ending].endSample === position) &&
    (starting < 0 || ranges[starting].startSample === position)
  ) {
    return null
  }

  const moved = new Array<TranscribedRange>()
  for (let index = 0; index < ranges.length; ++index) {
    let range = ranges[index]
    if (index === ending) {
      range = { ...range, endSample: position }
    } else if (index === starting) {
      range = { ...range, startSample: position }
    }
    // Only a gap can reach zero length.
    if ((index === ending || index === starting) && range.startSample >= range.endSample) continue
    const last = moved[moved.length - 1]
    if (
      last?.kind === 'silence' &&
      range.kind === 'silence' &&
      last.endSample === position &&
      range.startSample === position
    ) {
      moved[moved.length - 1] = { ...last, endSample: range.endSample }
    } else {
      moved.push(range)
    }
  }
  return { ranges: moved, sample: position }
}
