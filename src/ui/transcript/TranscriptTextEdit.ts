import type { Clip } from '../../project/Clip'
import type { TrackTranscriptEntry } from './TrackTranscript'

export interface TranscriptTextEdit {
  readonly clip: Clip
  readonly startSample: number
  readonly endSample: number
  readonly text: string
  readonly speechStartSample?: number
}

export function getTranscriptTextEdits(entries: readonly TrackTranscriptEntry[]): TranscriptTextEdit[] {
  const placements = new Map<number, { clip: Clip; startSample: number; endSample: number; order: number }>()
  entries.forEach((entry, order) => {
    const { clipView } = entry
    let startSample = clipView.offset + entry.startSample - clipView.startPosition
    let endSample = clipView.offset + entry.endSample - clipView.startPosition
    if (entry.kind === undefined) {
      // Projected indices omit trimmed atoms, so recover whole words by source intersection.
      for (const range of clipView.clip.transcription) {
        if (range.kind === undefined && range.startSample < endSample && range.endSample > startSample) {
          startSample = Math.min(startSample, range.startSample)
          endSample = Math.max(endSample, range.endSample)
        }
      }
    }
    const placement = placements.get(entry.placementIndex)
    if (placement) {
      placement.startSample = Math.min(placement.startSample, startSample)
      placement.endSample = Math.max(placement.endSample, endSample)
    } else {
      placements.set(entry.placementIndex, { clip: clipView.clip, startSample, endSample, order })
    }
  })

  const byClip = new Map<Clip, Array<{ clip: Clip; startSample: number; endSample: number; order: number }>>()
  for (const placement of placements.values()) {
    const intervals = byClip.get(placement.clip) ?? []
    intervals.push(placement)
    byClip.set(placement.clip, intervals)
  }

  const merged: Array<{ clip: Clip; startSample: number; endSample: number; order: number }> = []
  for (const intervals of byClip.values()) {
    intervals.sort((left, right) => left.startSample - right.startSample || left.endSample - right.endSample)
    let previous: (typeof intervals)[number] | undefined
    for (const interval of intervals) {
      if (previous && interval.startSample <= previous.endSample) {
        previous.endSample = Math.max(previous.endSample, interval.endSample)
        previous.order = Math.min(previous.order, interval.order)
      } else {
        merged.push(interval)
        previous = interval
      }
    }
  }

  return merged
    .sort((left, right) => left.order - right.order)
    .map(({ clip, startSample, endSample }) => {
      const ranges = clip.transcription.filter(
        (range) => range.startSample < endSample && range.endSample > startSample,
      )
      const words = ranges.filter((range) => range.kind === undefined)
      return {
        clip,
        startSample,
        endSample,
        text: words
          .map((word) => word.text.trim())
          .filter((text) => text.length > 0)
          .join(' '),
        speechStartSample: (words[0] ?? ranges[0])?.speechStartSample,
      }
    })
}
