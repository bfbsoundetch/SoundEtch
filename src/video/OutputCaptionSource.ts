import type { OutputCaptionCue, OutputCaptionSettings } from '../project/OutputCaptions'
import type { Project } from '../project/Project'
import type { Summary } from '../project/Summary'
import type { Track } from '../project/Track'
import { buildOutputCaptionCues, findOutputCaptionCue, findOutputCaptionWord, resolveOutputCaptionTrack } from './OutputCaptionCues'

interface PlacedSummary {
  readonly startSample: number
  readonly endSample: number
  readonly sourceShift: number
  readonly summary: Summary
}

interface SpeakingTrack {
  readonly cues: readonly OutputCaptionCue[]
  /** Only overlapping fragments need a fallback for a word behind a later fragment's pause. */
  readonly activeWords: readonly OutputCaptionCue[] | null
  readonly wordParents: ReadonlyMap<OutputCaptionCue, OutputCaptionCue> | null
  readonly track: Track
  audible: boolean
  gainSquared: number
  /** Two non-overlapping lanes cover the track's at-most-two simultaneous placements. */
  readonly lanes: readonly [readonly PlacedSummary[], readonly PlacedSummary[]]
}

/** Caption text and placements are fixed; only the live preview explicitly refreshes track levels. */
export class OutputCaptionSource {
  private readonly cues: readonly OutputCaptionCue[]
  private readonly speakers: readonly SpeakingTrack[]
  private readonly halfWindow: number

  constructor(project: Project, settings: Readonly<OutputCaptionSettings>) {
    this.halfWindow = project.sampleRate * 0.05
    if (!settings.followLoudest) {
      const track = resolveOutputCaptionTrack(project, settings)
      this.cues = track ? buildOutputCaptionCues(track, project.sampleRate) : []
      this.speakers = []
      return
    }

    this.cues = []
    const speakers: SpeakingTrack[] = []
    for (const track of project.getTracks()) {
      // Use the ordinary cue builder, but video-only placements must contribute
      // neither words nor level to the dynamic audio source.
      const clipViews: Track['clipViews'] = []
      const lanes: [PlacedSummary[], PlacedSummary[]] = [[], []]
      for (const view of track.clipViews) {
        if (!view.clip.audioPresent || view.length <= 0) continue
        clipViews.push(view)
        const placement: PlacedSummary = {
          startSample: view.startPosition,
          endSample: Math.min(view.getEndPosition(), view.startPosition + view.clip.summary.length - view.offset),
          sourceShift: view.offset - view.startPosition,
          summary: view.clip.summary,
        }
        if (placement.endSample <= placement.startSample) continue
        const first = lanes[0]
        const lane = first.length === 0 || first[first.length - 1].endSample <= placement.startSample ? first : lanes[1]
        lane.push(placement)
      }
      const cues = buildOutputCaptionCues({ clipViews }, project.sampleRate)
      if (cues.length === 0) continue
      const gain = track.getGain()
      let previousEnd = -Infinity
      let overlaps = false
      for (const cue of cues) {
        if (cue.startSample < previousEnd) overlaps = true
        previousEnd = Math.max(previousEnd, cue.endSample)
      }
      let activeWords: OutputCaptionCue[] | null = null
      let wordParents: Map<OutputCaptionCue, OutputCaptionCue> | null = null
      if (overlaps) {
        activeWords = []
        wordParents = new Map()
        for (const cue of cues) {
          for (const word of cue.words) {
            const interval = { startSample: word.startSample, endSample: word.endSample, words: cue.words }
            activeWords.push(interval)
            wordParents.set(interval, cue)
          }
        }
        activeWords.sort((a, b) => a.startSample - b.startSample || a.endSample - b.endSample)
        // Prepare any overlapping-interval lookup now, never during frame rendering.
        findOutputCaptionCue(activeWords, previousEnd)
      }
      speakers.push({ track, audible: project.isTrackAudible(track), cues, lanes, gainSquared: gain * gain, activeWords, wordParents })
    }
    this.speakers = speakers
  }

  get hasCues(): boolean {
    if (this.cues.length > 0) return true
    for (const speaker of this.speakers) if (speaker.audible) return true
    return false
  }

  /** Refresh fader/mute/solo changes without rebuilding transcript or placement snapshots. Export never calls this. */
  updateLevels(project: Project): boolean {
    let changed = false
    const tracks = project.getTracks()
    for (const speaker of this.speakers) {
      const audible = tracks.includes(speaker.track) && project.isTrackAudible(speaker.track)
      const gain = speaker.track.getGain()
      const gainSquared = gain * gain
      if (audible !== speaker.audible || gainSquared !== speaker.gainSquared) {
        speaker.audible = audible
        speaker.gainSquared = gainSquared
        changed = true
      }
    }
    return changed
  }

  getCue(sample: number): OutputCaptionCue | null {
    if (!Number.isFinite(sample)) return null
    if (this.speakers.length === 0) return findOutputCaptionCue(this.cues, sample)

    const start = sample - this.halfWindow
    const end = sample + this.halfWindow
    let selected: OutputCaptionCue | null = null
    let selectedLevel = 0
    let selectedHasWord = false
    for (const speaker of this.speakers) {
      if (!speaker.audible) continue
      let cue = findOutputCaptionCue(speaker.cues, sample)
      if (!cue) continue
      let hasWord = findOutputCaptionWord(cue, sample) >= 0
      if (!hasWord && speaker.activeWords) {
        const activeWord = findOutputCaptionCue(speaker.activeWords, sample)
        if (activeWord) {
          cue = speaker.wordParents!.get(activeWord)!
          hasWord = true
        }
      }
      if (selectedHasWord && !hasWord) continue
      const level = (getLaneEnergy(speaker.lanes[0], start, end) + getLaneEnergy(speaker.lanes[1], start, end)) * speaker.gainSquared
      // All candidates share the same 100 ms denominator, so compare energy
      // directly. Strict comparisons preserve project order on equal levels.
      if (level > 0 && ((hasWord && !selectedHasWord) || level > selectedLevel)) {
        selected = cue
        selectedLevel = level
        selectedHasWord = hasWord
      }
    }
    return selected
  }
}

/** Sum source-aligned mean-square levels weighted by the played window overlap. */
function getLaneEnergy(lane: readonly PlacedSummary[], start: number, end: number): number {
  let low = 0
  let high = lane.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (lane[middle].endSample <= start) low = middle + 1
    else high = middle
  }
  let energy = 0
  for (let index = low; index < lane.length; index++) {
    const placement = lane[index]
    if (placement.startSample >= end) break
    const overlapStart = Math.max(start, placement.startSample)
    const overlapEnd = Math.min(end, placement.endSample)
    energy += placement.summary.getMeanSquaredPeak(
      overlapStart + placement.sourceShift,
      overlapEnd + placement.sourceShift,
    ) * (overlapEnd - overlapStart)
  }
  return energy
}
