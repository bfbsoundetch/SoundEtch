import type { SelectedRegion } from '../playback/Player'
import type { Clip } from '../project/Clip'
import type { TranscribedRange } from '../project/Transcription'

export interface SelectedClipInterval {
  readonly clip: Clip
  readonly startSample: number
  readonly endSample: number
}

export interface TranscriptionReplacement {
  readonly startSample: number
  readonly endSample: number
  readonly ranges: readonly TranscribedRange[]
}

export function getSelectedClipIntervals(selection: SelectedRegion): SelectedClipInterval[] {
  if (selection.startSample >= selection.endSample) {
    return []
  }

  const intervalsByClip = new Map<Clip, Array<Omit<SelectedClipInterval, 'clip'>>>()
  for (const track of selection.tracks) {
    for (const clipView of track.clipViews) {
      if (!clipView.clip.audioPresent) {
        continue
      }
      const intersectionStart = Math.max(selection.startSample, clipView.startPosition)
      const audioEnd = clipView.startPosition + Math.max(0, clipView.clip.summary.length - clipView.offset)
      const intersectionEnd = Math.min(selection.endSample, clipView.getEndPosition(), audioEnd)
      if (intersectionStart >= intersectionEnd) {
        continue
      }
      const intervals = intervalsByClip.get(clipView.clip) ?? []
      intervals.push({
        startSample: clipView.offset + intersectionStart - clipView.startPosition,
        endSample: clipView.offset + intersectionEnd - clipView.startPosition,
      })
      intervalsByClip.set(clipView.clip, intervals)
    }
  }

  const result = new Array<SelectedClipInterval>()
  for (const [clip, intervals] of intervalsByClip) {
    intervals.sort((left, right) => left.startSample - right.startSample || left.endSample - right.endSample)
    let mergedStart = intervals[0].startSample
    let mergedEnd = intervals[0].endSample
    for (let index = 1; index < intervals.length; ++index) {
      const interval = intervals[index]
      if (interval.startSample <= mergedEnd) {
        mergedEnd = Math.max(mergedEnd, interval.endSample)
      } else {
        result.push({ clip, startSample: mergedStart, endSample: mergedEnd })
        mergedStart = interval.startSample
        mergedEnd = interval.endSample
      }
    }
    result.push({ clip, startSample: mergedStart, endSample: mergedEnd })
  }
  return result
}

export function replaceTranscriptionRanges(
  current: readonly TranscribedRange[],
  replacements: readonly TranscriptionReplacement[],
): TranscribedRange[] {
  const generated = replacements
    .flatMap((replacement) => replacement.ranges)
    .slice()
    .sort((left, right) => left.startSample - right.startSample || left.endSample - right.endSample)
  for (let index = 0; index < generated.length; ++index) {
    const range = generated[index]
    if (range.startSample >= range.endSample) {
      throw new Error('Generated transcription ranges must have positive length')
    }
    if (index > 0 && range.startSample < generated[index - 1].endSample) {
      throw new Error('Generated transcription ranges must not overlap')
    }
  }

  const preserved = current.flatMap((range) => {
    const overlapping = replacements
      .filter((replacement) => range.startSample < replacement.endSample && range.endSample > replacement.startSample)
      .sort((left, right) => left.startSample - right.startSample)
    if (overlapping.length === 0) {
      return [range]
    }
    // A word is indivisible; a gap keeps its parts outside the regenerated intervals.
    if (range.kind === undefined) {
      return []
    }
    const parts = new Array<TranscribedRange>()
    let startSample = range.startSample
    for (const replacement of overlapping) {
      if (startSample < replacement.startSample) {
        parts.push({ ...range, startSample, endSample: replacement.startSample })
      }
      startSample = Math.max(startSample, replacement.endSample)
    }
    if (startSample < range.endSample) {
      parts.push({ ...range, startSample })
    }
    return parts
  })

  // Contiguous silence from separate generations reads as one pause.
  const merged = new Array<TranscribedRange>()
  for (const range of [...preserved, ...generated].sort(
    (left, right) => left.startSample - right.startSample || left.endSample - right.endSample,
  )) {
    const previous = merged[merged.length - 1]
    if (previous?.kind === 'silence' && range.kind === 'silence' && previous.endSample === range.startSample) {
      merged[merged.length - 1] = { ...previous, endSample: range.endSample }
    } else {
      merged.push(range)
    }
  }
  return merged
}

export function transcriptionRangesEqual(
  left: readonly TranscribedRange[],
  right: readonly TranscribedRange[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (range, index) =>
        range.text === right[index].text &&
        range.startSample === right[index].startSample &&
        range.endSample === right[index].endSample &&
        range.speechStartSample === right[index].speechStartSample &&
        range.kind === right[index].kind,
    )
  )
}
