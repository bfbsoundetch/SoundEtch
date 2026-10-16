import type { ClipView } from '../../project/ClipView'
import type { Track } from '../../project/Track'
import type { TranscriptGapKind } from '../../project/Transcription'
import { projectVisibleTranscribedRanges } from '../timeline/TranscriptionOverlay'

export interface TrackTranscriptEntry {
  readonly clipView: ClipView
  readonly placementIndex: number
  readonly rangeIndex: number
  readonly text: string
  readonly startSample: number
  readonly endSample: number
  readonly speechStartSample?: number
  readonly kind?: TranscriptGapKind
}

export function getTrackTranscriptEntries(track: Track): TrackTranscriptEntry[] {
  const entries: TrackTranscriptEntry[] = []
  track.clipViews.forEach((clipView, placementIndex) => {
    if (clipView.length <= 0) return
    const placementEnd = clipView.getEndPosition()
    const ranges = projectVisibleTranscribedRanges(
      clipView.clip.transcription,
      clipView.offset,
      clipView.offset + clipView.length,
      clipView.startPosition,
      clipView.startPosition,
      placementEnd,
    )
    ranges.forEach((range, rangeIndex) => {
      const startSample = Math.max(clipView.startPosition, range.startSample)
      const endSample = Math.min(placementEnd, range.endSample)
      if ((range.kind === undefined && range.text.trim().length === 0) || startSample >= endSample) return
      entries.push({
        clipView,
        placementIndex,
        rangeIndex,
        text: range.text,
        startSample,
        endSample,
        speechStartSample: range.speechStartSample,
        kind: range.kind,
      })
    })
  })
  return entries.sort(
    (a, b) =>
      a.startSample - b.startSample ||
      a.endSample - b.endSample ||
      a.placementIndex - b.placementIndex ||
      a.rangeIndex - b.rangeIndex,
  )
}

/**
 * Groups sorted entries into one paragraph per VAD speech region. Silence
 * belongs to no region: it ends the current paragraph, or opens the transcript.
 */
export function splitTranscriptParagraphs(entries: readonly TrackTranscriptEntry[]): TrackTranscriptEntry[][] {
  const paragraphs: TrackTranscriptEntry[][] = []
  let region: TrackTranscriptEntry | null = null
  for (const entry of entries) {
    const paragraph = paragraphs[paragraphs.length - 1]
    if (entry.kind === 'silence') {
      if (paragraph) paragraph.push(entry)
      else paragraphs.push([entry])
      continue
    }
    if (
      !region ||
      entry.speechStartSample !== region.speechStartSample ||
      (entry.speechStartSample !== undefined && entry.clipView.clip !== region.clipView.clip)
    )
      paragraphs.push([entry])
    else paragraph.push(entry)
    region = entry
  }
  return paragraphs
}

export function getTranscriptEntriesInRange(
  entries: readonly TrackTranscriptEntry[],
  startSample: number,
  endSample: number,
): TrackTranscriptEntry[] {
  if (startSample >= endSample) return []
  return entries.filter((entry) => entry.startSample < endSample && entry.endSample > startSample)
}
