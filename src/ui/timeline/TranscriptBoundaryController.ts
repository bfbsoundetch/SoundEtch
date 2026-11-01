import { AudioControl } from '../../audiocontext/AudioControl'
import type { Clip } from '../../project/Clip'
import { moveTranscriptBoundary, type TranscribedRange } from '../../project/Transcription'
import { NotificationsController } from '../NotificationsController'
import { SetClipTranscriptionCommand } from '../undo/UndoableActions'
import { stepTimelinePosition } from './TimelineKeyboardSteps'
import type { TrackListController } from './TrackListController'

/** A boundary grabbed or focused in the transcript lane of one view of a clip. */
export interface TranscriptBoundaryGrab {
  readonly clip: Clip
  /** The boundary in clip source samples. */
  readonly sample: number
  /** The source audio the view plays, which the boundary stays within. */
  readonly minimumSample: number
  readonly maximumSample: number
  /** Added to a source sample, gives its timeline position in that view. */
  readonly timelineShift: number
  /** Keeps keyboard focus in that lane on the boundary now at `sample`. */
  readonly focus: (sample: number) => void
}

interface BoundaryDrag extends TranscriptBoundaryGrab {
  readonly before: readonly TranscribedRange[]
  readonly handle: Element
  readonly pointerId: number
  /** Set once released, while the edit commits. */
  committing: boolean
  clientX: number
  /** Timeline samples from the pointer to the boundary when grabbed. */
  readonly grabOffset: number
  target: number
  tolerance: number
  preview: readonly TranscribedRange[]
  position: number
}

/** Edges this close join, limits this close snap, and words stop shrinking this wide. */
const SLIVER_PIXELS = 3

const cancelledBoundaryMove = new Error('The transcript boundary is no longer editable.')

/**
 * Moves boundaries in the transcript lanes by pointer and keyboard. Lanes preview a drag, while
 * the clip's transcript, the transcript panel, and persistence see only committed edits.
 */
export class TranscriptBoundaryController {
  private drag: BoundaryDrag | null = null
  private editing = false
  private readonly trackListElement = document.getElementById('track-list')!

  constructor(private readonly trackList: TrackListController) {
    document.addEventListener('pointermove', (event) => {
      const drag = this.activeDrag(event.pointerId)
      if (!drag) return
      drag.clientX = event.clientX
      if (this.isValid(drag)) this.redraw()
      else this.cancel()
    })
    document.addEventListener('pointerup', (event) => {
      const drag = this.activeDrag(event.pointerId)
      if (!drag) return
      drag.clientX = event.clientX
      if (!this.isValid(drag)) {
        this.cancel()
        return
      }
      this.update(drag)
      if (drag.preview === drag.before) {
        this.cancel()
        return
      }
      drag.committing = true
      this.release(drag)
      void this.commit(drag.clip, drag.before, drag.preview).then((committed) => {
        if (this.drag === drag) {
          this.drag = null
          this.redraw()
        }
        drag.focus(committed ? drag.position : drag.sample)
      })
    })
    for (const name of ['pointercancel', 'lostpointercapture'] as const) {
      document.addEventListener(name, (event) => {
        if (this.activeDrag(event.pointerId)) this.cancel()
      })
    }
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !this.drag || this.drag.committing) return
      event.preventDefault()
      event.stopPropagation()
      this.cancel()
    })
    window.addEventListener('blur', () => this.cancel())
    this.trackList.history.addChangeListener(() => this.cancel())
    AudioControl.addAudioControlListener(() => this.refresh())
  }

  /** True while an edit commits; lanes wait for it before moving focus elsewhere. */
  get isEditing(): boolean {
    return this.editing
  }

  /** The ranges `clip`'s lanes draw: a drag's preview until its edit commits, otherwise the transcript. */
  transcription(clip: Clip): readonly TranscribedRange[] {
    return this.previewing(clip)?.preview ?? clip.transcription
  }

  /** The boundary being dragged in `clip`, in clip source samples. */
  activeSample(clip: Clip): number | null {
    return this.previewing(clip)?.position ?? null
  }

  /** In samples at the current zoom: closer edges move together and limits this close snap. */
  tolerance(): number {
    return Math.max(1, Math.round(SLIVER_PIXELS * this.trackList.sampleScale))
  }

  /** Follows a change in whether the timeline can be edited. */
  refresh(): void {
    const editable = this.trackList.canEdit()
    this.trackListElement.classList.toggle('transcript-boundaries-locked', !editable)
    if (!editable) this.cancel()
    this.redraw()
  }

  /** Starts dragging the boundary under an unmodified primary press on `handle`; other presses fall through. */
  start(event: PointerEvent, handle: Element, grab: TranscriptBoundaryGrab): void {
    if (
      event.button !== 0 ||
      !event.isPrimary ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      this.drag ||
      this.editing ||
      !this.trackList.canEdit()
    ) {
      return
    }
    // Suppresses the mouse events that would otherwise seek or select.
    event.preventDefault()
    this.trackList.clearSelection()
    handle.setPointerCapture(event.pointerId)
    this.drag = {
      ...grab,
      before: grab.clip.transcription,
      handle,
      pointerId: event.pointerId,
      committing: false,
      clientX: event.clientX,
      grabOffset: grab.sample + grab.timelineShift - this.sampleAt(event.clientX),
      target: grab.sample,
      tolerance: -1,
      preview: grab.clip.transcription,
      position: grab.sample,
    }
    this.redraw()
  }

  /**
   * Moves a focused boundary: arrows by a ruler tick, Page Up/Down by a major tick, and Home/End
   * to its limits, each as one undoable edit. Plus and minus zoom around it.
   */
  handleKey(event: KeyboardEvent, grab: TranscriptBoundaryGrab): void {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const position = grab.sample + grab.timelineShift
    if (event.key === '+' || event.key === '=' || event.key === '-' || event.key === '_') {
      event.preventDefault()
      event.stopPropagation()
      const x = position / this.trackList.sampleScale - this.trackList.translation
      this.trackList.zoomBy(
        event.key === '+' || event.key === '=' ? 0.8 : 1.25,
        x >= 0 && x <= this.trackList.width ? x : this.trackList.width / 2,
      )
      return
    }
    if (event.shiftKey) return
    const { minor, major } = this.trackList.timelineController.getKeyboardSteps()
    let target: number
    switch (event.key) {
      case 'ArrowLeft':
        target = stepTimelinePosition(position, minor, -1) - grab.timelineShift
        break
      case 'ArrowRight':
        target = stepTimelinePosition(position, minor, 1) - grab.timelineShift
        break
      case 'PageDown':
        target = stepTimelinePosition(position, major, -1) - grab.timelineShift
        break
      case 'PageUp':
        target = stepTimelinePosition(position, major, 1) - grab.timelineShift
        break
      case 'Home':
        target = grab.minimumSample
        break
      case 'End':
        target = grab.maximumSample
        break
      default:
        return
    }
    event.preventDefault()
    event.stopPropagation()
    if (this.drag || this.editing || !this.trackList.canEdit()) return
    const before = grab.clip.transcription
    const moved = moveTranscriptBoundary(before, grab.sample, target, {
      minimumSample: grab.minimumSample,
      maximumSample: grab.maximumSample,
      tolerance: this.tolerance(),
    })
    if (!moved) return
    const committed = this.commit(grab.clip, before, moved.ranges)
    // Lanes keep focus where it is until the moved boundary is drawn.
    grab.focus(moved.sample)
    void committed.then((done) => {
      if (done) this.trackList.keepSampleVisible(moved.sample + grab.timelineShift)
      else grab.focus(grab.sample)
    })
  }

  private previewing(clip: Clip): BoundaryDrag | null {
    const drag = this.drag
    if (drag?.clip !== clip || clip.transcription !== drag.before) return null
    if (!drag.committing) this.update(drag)
    return drag
  }

  private activeDrag(pointerId: number): BoundaryDrag | null {
    const drag = this.drag
    return drag && !drag.committing && drag.pointerId === pointerId ? drag : null
  }

  private isValid(drag: BoundaryDrag): boolean {
    return drag.clip.transcription === drag.before && this.trackList.canEdit()
  }

  private sampleAt(clientX: number): number {
    return (this.trackList.mouseXToSvgCoord(clientX) + this.trackList.translation) * this.trackList.sampleScale
  }

  private update(drag: BoundaryDrag): void {
    const tolerance = this.tolerance()
    const target = Math.round(this.sampleAt(drag.clientX) + drag.grabOffset) - drag.timelineShift
    if (target === drag.target && tolerance === drag.tolerance) return
    drag.target = target
    drag.tolerance = tolerance
    // Returning to the grabbed position leaves the transcript as it was.
    const moved =
      target === drag.sample
        ? null
        : moveTranscriptBoundary(drag.before, drag.sample, target, {
            minimumSample: drag.minimumSample,
            maximumSample: drag.maximumSample,
            tolerance,
          })
    drag.preview = moved?.ranges ?? drag.before
    drag.position = moved?.sample ?? drag.sample
  }

  private release(drag: BoundaryDrag): void {
    if (drag.handle.hasPointerCapture(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId)
  }

  private cancel(): void {
    const drag = this.drag
    if (!drag || drag.committing) return
    this.drag = null
    this.release(drag)
    this.redraw()
    drag.focus(drag.sample)
  }

  private redraw(): void {
    for (const waveform of this.trackList.waveforms) waveform.drawTranscriptionOverlays()
  }

  /** Records `after` as one undoable edit unless `clip`'s transcript changed first; resolves whether it did. */
  private async commit(
    clip: Clip,
    before: readonly TranscribedRange[],
    after: readonly TranscribedRange[],
  ): Promise<boolean> {
    this.editing = true
    let command: SetClipTranscriptionCommand | null = null
    try {
      const action = {
        perform: async () => {
          if (!command) {
            if (clip.transcription !== before || !this.trackList.canEdit()) throw cancelledBoundaryMove
            command = new SetClipTranscriptionCommand(clip, before, after)
          }
          await command.perform()
        },
        undo: async () => {
          await command!.undo()
        },
        save: async () => {
          await command!.save()
        },
        toString: () => 'move transcript boundary',
      }
      await this.trackList.history.execute(action)
      return true
    } catch (error) {
      if (error !== cancelledBoundaryMove) {
        NotificationsController.showError(error instanceof Error ? error : new Error(String(error)))
      }
      return false
    } finally {
      this.editing = false
    }
  }
}
