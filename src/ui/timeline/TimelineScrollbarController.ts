import { TimeUtils } from '../../global/TimeUtils'
import type { Project } from '../../project/Project'
import { ProjectManager } from '../../project/ProjectManager'
import type { TrackListController } from './TrackListController'

/** The range is fixed when a drag starts, so the thumb keeps up with the pointer even while the view is past the end. */
type ThumbDrag = { pointerId: number; grabOffset: number; maxTranslation: number }

/**
 * The horizontal scroll bar under the lanes, for hardware without a horizontal scroll gesture. Its range runs from
 * time 0 to the end of the last track, extended to the view while that is past the end. Dragging or pressing anywhere
 * on it, a wheel over it, and the keyboard pan the timeline.
 */
export class TimelineScrollbarController {
  private readonly element = document.getElementById('timeline-scrollbar')!
  private readonly thumb = document.getElementById('timeline-scrollbar-thumb')!
  private project: Project | null = null
  private drag: ThumbDrag | null = null
  private renderedWidth = NaN
  private renderedValueNow = ''
  private renderedValueText = ''

  constructor(private readonly timeline: TrackListController) {
    this.element.addEventListener('pointerdown', (event) => this.startDrag(event))
    this.element.addEventListener('pointermove', (event) => {
      if (event.pointerId === this.drag?.pointerId) this.dragTo(event.clientX)
    })
    // Chrome on macOS can drop pointerup after a fast release (crbug.com/489633223); capture loss still ends the drag.
    for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      this.element.addEventListener(eventName, (event) => {
        if (event.pointerId !== this.drag?.pointerId) return
        this.drag = null
        this.thumb.classList.remove('is-dragging')
        this.draw()
      })
    }
    this.element.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault()
        if (event.ctrlKey) {
          this.timeline.zoomWithWheel(event)
          return
        }
        // Over the bar, a plain vertical wheel pans instead of scrolling the tracks.
        const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
        this.scrollWithinRange(this.timeline.translation + delta)
      },
      { passive: false },
    )
    this.element.addEventListener('keydown', (event) => this.handleKeyDown(event))
    void ProjectManager.addProjectListener((project) => {
      this.project = project
      this.draw()
    })
  }

  draw(): void {
    const width = this.timeline.width
    if (width !== this.renderedWidth) {
      this.renderedWidth = width
      this.element.style.width = `${width}px`
    }
    const maxTranslation = this.maxTranslation()
    const translation = Math.min(this.timeline.translation, maxTranslation)
    this.thumb.hidden = maxTranslation <= 0
    const thumbWidth = this.thumbWidth(width, maxTranslation)
    const fraction = maxTranslation > 0 ? translation / maxTranslation : 0
    this.thumb.style.width = `${thumbWidth}px`
    this.thumb.style.left = `${fraction * (width - thumbWidth)}px`
    const valueNow = `${Math.round(fraction * 100)}`
    if (valueNow !== this.renderedValueNow) {
      this.renderedValueNow = valueNow
      this.element.setAttribute('aria-valuenow', valueNow)
    }

    const msPerUnit = this.timeline.msScale
    if (!Number.isFinite(msPerUnit)) return
    // Whole seconds, so playback following the position marker rewrites this at most once a second.
    const spoken = (units: number) => TimeUtils.toSpokenString(Math.round((units * msPerUnit) / 1000) * 1000)
    const total = this.project ? Math.max(0, this.project.getLength()) / this.timeline.sampleScale : 0
    const valueText = `Showing ${spoken(translation)} to ${spoken(translation + width)} of ${spoken(total)}`
    if (valueText !== this.renderedValueText) {
      this.renderedValueText = valueText
      this.element.setAttribute('aria-valuetext', valueText)
    }
  }

  /** How far the view's left edge pans with the end of the last track still in view; 0 when everything fits. */
  private contentMaxTranslation(): number {
    const scale = this.timeline.sampleScale
    if (!this.project || !Number.isFinite(scale) || scale <= 0) return 0
    return Math.max(0, Math.max(0, this.project.getLength()) / scale - this.timeline.width)
  }

  private maxTranslation(): number {
    return this.drag?.maxTranslation ?? Math.max(this.contentMaxTranslation(), this.timeline.translation)
  }

  /** The view's share of the range, kept wide enough to grab. */
  private thumbWidth(width: number, maxTranslation: number): number {
    return Math.min(width, Math.max(2 * this.timeline.rootFontSize, (width * width) / (width + maxTranslation)))
  }

  private startDrag(event: PointerEvent): void {
    if (event.button !== 0 || !event.isPrimary || this.thumb.hidden) return
    // Like a native scroll bar, a press leaves keyboard focus where it was.
    event.preventDefault()
    const thumb = this.thumb.getBoundingClientRect()
    // A press beside the thumb centers the thumb there and carries on as a drag.
    const grabOffset = event.target === this.thumb ? event.clientX - thumb.left : thumb.width / 2
    this.drag = { pointerId: event.pointerId, grabOffset, maxTranslation: this.maxTranslation() }
    this.element.setPointerCapture(event.pointerId)
    this.thumb.classList.add('is-dragging')
    this.dragTo(event.clientX)
  }

  private dragTo(clientX: number): void {
    const drag = this.drag!
    const width = this.timeline.width
    const travel = width - this.thumbWidth(width, drag.maxTranslation)
    const left = clientX - drag.grabOffset - this.element.getBoundingClientRect().left
    this.timeline.setTranslation(travel > 0 ? Math.min(Math.max(left / travel, 0), 1) * drag.maxTranslation : 0)
  }

  /** Arrows step a tenth of the view, Page Up/Down a whole view, Home/End go to time 0 and the last track's end. */
  private handleKeyDown(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    const translation = this.timeline.translation
    const width = this.timeline.width
    let target: number
    switch (event.key) {
      case 'ArrowLeft':
        target = translation - width / 10
        break
      case 'ArrowRight':
        target = translation + width / 10
        break
      case 'PageUp':
        target = translation - width
        break
      case 'PageDown':
        target = translation + width
        break
      case 'Home':
        target = 0
        break
      case 'End':
        target = this.contentMaxTranslation()
        break
      default:
        return
    }
    event.preventDefault()
    this.scrollWithinRange(target)
  }

  /** Past the last track's end, the view only moves back towards it. */
  private scrollWithinRange(translation: number): void {
    this.timeline.setTranslation(Math.min(translation, this.maxTranslation()))
  }
}
