import { AudioControl } from '../../audiocontext/AudioControl'
import { TimeUtils } from '../../global/TimeUtils'
import { announce } from '../LiveAnnouncer'
import { stepTimelinePosition } from './TimelineKeyboardSteps'
import type { TrackListController } from './TrackListController'
import type { Waveform } from './Waveform'

const TIMELINE_HINT = '←/→ move · Shift+←/→ select · Shift+F10 actions · +/− zoom'

/** One focusable slider-like control per track that gives the timeline a keyboard model. */
export class TimelineKeyboardController {
  private readonly controls = new WeakMap<Waveform, HTMLDivElement>()
  private anchorSample: number | null = null
  private focusSample: number | null = null
  private lastKeyboardRegion: { start: number; end: number } | null = null

  constructor(private readonly trackList: TrackListController) {}

  attach(waveform: Waveform): void {
    const control = document.createElement('div')
    control.className = 'track-timeline-control'
    control.tabIndex = 0
    control.setAttribute('role', 'slider')
    control.setAttribute('aria-roledescription', 'timeline')
    control.setAttribute('aria-orientation', 'horizontal')
    control.setAttribute('aria-valuemin', '0')
    control.setAttribute('aria-valuenow', '0')
    control.setAttribute('aria-valuemax', '0')
    control.setAttribute('aria-describedby', 'timeline-keyboard-help')
    control.dataset.hint = TIMELINE_HINT
    control.addEventListener('keydown', (event) => this.handleKeyDown(event, waveform))
    control.addEventListener('contextmenu', (event) => {
      event.preventDefault()
      event.stopPropagation()
      this.openMenu(waveform)
    })
    waveform.div.prepend(control)
    this.controls.set(waveform, control)
    this.refresh()
  }

  refresh(): void {
    const sampleRate = this.trackList.sampleRate
    if (sampleRate == 0) {
      return
    }
    const region = this.trackList.selectedRegion
    const maxLength = Math.max(0, ...this.trackList.waveforms.map((w) => w.track.length))
    for (const waveform of this.trackList.waveforms) {
      const control = this.controls.get(waveform)
      if (!control) {
        continue
      }
      const inRegion = region !== null && this.trackList.selectionController.isInRegion(waveform)
      const cursor = AudioControl.startPosition
      const value = inRegion ? region.startSample : cursor
      let valueText: string
      if (inRegion) {
        valueText = `Selected ${this.spoken(region.startSample)} to ${this.spoken(region.endSample)}`
      } else {
        const clip = waveform.clipViewAt(cursor)
        const clipLabel = clip
          ? `in ${clip.clip.videoSegments.length > 0 ? 'video ' : ''}clip ${clip.clip.name}${clip.clip.audioPresent ? '' : ', no audio'}`
          : 'no clip'
        valueText = `${cursor == 0 ? 'Cursor at start' : `Cursor at ${this.spoken(cursor)}`}, ${clipLabel}`
      }
      const media =
        waveform.videoLaneHeight > 0
          ? waveform.track.clipViews.some((view) => view.clip.audioPresent)
            ? ' linked video and audio'
            : ' video'
          : ''
      setAttributeIfChanged(control, 'aria-label', `${waveform.track.name}${media} timeline`)
      setAttributeIfChanged(control, 'data-hint', `${media ? `${media.trim()} · ` : ''}${TIMELINE_HINT}`)
      setAttributeIfChanged(control, 'aria-valuenow', (value / sampleRate).toFixed(3))
      setAttributeIfChanged(control, 'aria-valuemax', (Math.max(value, maxLength) / sampleRate).toFixed(3))
      setAttributeIfChanged(control, 'aria-valuetext', valueText)
    }
  }

  focusedWaveform(): Waveform | null {
    return this.trackList.waveforms.find((w) => this.controls.get(w) === document.activeElement) ?? null
  }

  focus(waveform: Waveform): void {
    this.controls.get(waveform)?.focus()
  }

  private spoken(samples: number) {
    return TimeUtils.toSpokenString((samples * 1000) / this.trackList.sampleRate)
  }

  private handleKeyDown(event: KeyboardEvent, waveform: Waveform) {
    if (event.defaultPrevented) {
      return
    }
    if (event.key == 'ContextMenu' || (event.shiftKey && event.key == 'F10')) {
      event.preventDefault()
      this.openMenu(waveform)
      return
    }
    if (!this.trackList.canEdit()) {
      return
    }
    const usesModifier = event.ctrlKey || event.metaKey
    if (usesModifier && !event.shiftKey && !event.altKey && event.code == 'KeyA') {
      event.preventDefault()
      this.trackList.selectTrack(waveform)
      this.anchorSample = 0
      this.focusSample = waveform.track.length
      this.lastKeyboardRegion = { start: 0, end: waveform.track.length }
      this.refresh()
      return
    }
    if (usesModifier) {
      return
    }
    if (event.altKey && event.shiftKey && (event.key == 'ArrowDown' || event.key == 'ArrowUp')) {
      event.preventDefault()
      this.extendTracks(event.key == 'ArrowDown' ? 1 : -1)
      return
    }
    if (event.altKey) {
      return
    }

    const { minor, major } = this.trackList.timelineController.getKeyboardSteps()
    let target: ((position: number) => number) | null = null
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        target = (p) => stepTimelinePosition(p, minor, 1)
        break
      case 'ArrowLeft':
      case 'ArrowDown':
        target = (p) => stepTimelinePosition(p, minor, -1)
        break
      case 'PageUp':
        target = (p) => stepTimelinePosition(p, major, 1)
        break
      case 'PageDown':
        target = (p) => stepTimelinePosition(p, major, -1)
        break
      case 'Home':
        target = () => 0
        break
      case 'End':
        target = () => Math.max(0, ...this.trackList.waveforms.map((w) => w.track.length))
        break
    }
    if (target) {
      event.preventDefault()
      if (event.shiftKey) {
        this.extendSelection(waveform, target)
      } else {
        this.moveCursor(target)
      }
      return
    }

    switch (event.key) {
      case 'Escape':
        if (this.trackList.selectedRegion) {
          event.preventDefault()
          this.trackList.clearSelection()
          this.resetAnchor()
          this.refresh()
        }
        break
      case 'Delete':
      case 'Backspace':
        if (this.trackList.selectedRegion) {
          event.preventDefault()
          void this.trackList.sliceSelection(true)
        }
        break
      case '+':
      case '=':
        event.preventDefault()
        this.trackList.zoomBy(0.8, this.anchorX(waveform))
        break
      case '-':
      case '_':
        event.preventDefault()
        this.trackList.zoomBy(1.25, this.anchorX(waveform))
        break
    }
  }

  private extendTracks(direction: 1 | -1) {
    const region = this.trackList.selectedRegion
    if (!region) {
      return
    }
    const waveforms = this.trackList.waveforms
    const selected = waveforms.filter((w) => this.trackList.selectionController.isInRegion(w))
    if (selected.length == 0) {
      return
    }
    const edge = direction > 0 ? selected[selected.length - 1].index + 1 : selected[0].index - 1
    const added = waveforms[edge]
    if (!added) {
      return
    }
    const next = new Set([...selected, added])
    this.trackList.selectionController.setSelection(region.startSample, region.endSample, next)
    this.lastKeyboardRegion = { start: region.startSample, end: region.endSample }
    announce(`Selection spans ${next.size} tracks`)
    this.refresh()
  }

  private regionMatchesKeyboard() {
    const region = this.trackList.selectedRegion
    return (
      region !== null &&
      this.lastKeyboardRegion !== null &&
      this.lastKeyboardRegion.start == region.startSample &&
      this.lastKeyboardRegion.end == region.endSample
    )
  }

  private moveCursor(target: (position: number) => number) {
    const region = this.trackList.selectedRegion
    const reference = region
      ? this.regionMatchesKeyboard() && this.focusSample !== null
        ? this.focusSample
        : region.endSample
      : AudioControl.startPosition
    const position = Math.max(0, target(reference))
    this.resetAnchor()
    AudioControl.startPosition = position
    this.trackList.clearSelection()
    this.trackList.positionMarkerController.draw()
    this.trackList.keepSampleVisible(position)
    this.refresh()
  }

  private extendSelection(waveform: Waveform, target: (position: number) => number) {
    const region = this.trackList.selectedRegion
    if (!this.regionMatchesKeyboard()) {
      this.anchorSample = region?.startSample ?? AudioControl.startPosition
      this.focusSample = region?.endSample ?? AudioControl.startPosition
    }
    const anchor = this.anchorSample!
    const position = Math.max(0, target(this.focusSample!))
    this.focusSample = position
    if (position == anchor) {
      this.trackList.clearSelection()
      this.lastKeyboardRegion = null
      AudioControl.startPosition = anchor
      this.trackList.positionMarkerController.draw()
    } else {
      const inRegion = region !== null && this.trackList.selectionController.isInRegion(waveform)
      const waveforms = inRegion
        ? new Set(this.trackList.waveforms.filter((w) => this.trackList.selectionController.isInRegion(w)))
        : new Set([waveform])
      const start = Math.min(anchor, position)
      const end = Math.max(anchor, position)
      this.trackList.selectionController.setSelection(start, end, waveforms)
      this.lastKeyboardRegion = { start, end }
    }
    this.trackList.keepSampleVisible(position)
    this.refresh()
  }

  private resetAnchor() {
    this.anchorSample = null
    this.focusSample = null
    this.lastKeyboardRegion = null
  }

  private anchorX(waveform: Waveform) {
    const region = this.trackList.selectedRegion
    const sample =
      region && this.regionMatchesKeyboard() && this.focusSample !== null
        ? this.focusSample
        : region
          ? region.endSample
          : AudioControl.startPosition
    const x = waveform.getXValueForSample(sample)
    return x >= 0 && x <= this.trackList.width ? x : this.trackList.width / 2
  }

  private openMenu(waveform: Waveform) {
    const region = this.trackList.selectedRegion
    const inRegion = region !== null && this.trackList.selectionController.isInRegion(waveform)
    const sample = inRegion ? region.startSample : AudioControl.startPosition
    this.trackList.keepSampleVisible(sample)
    const bounds = waveform.div.getBoundingClientRect()
    const x = bounds.left + Math.min(Math.max(waveform.getXValueForSample(sample), 0), bounds.width)
    const y = bounds.top + waveform.audioLaneTop
    const target = { trackIndex: waveform.index, sample }
    if (inRegion) {
      this.trackList.timelineSelectionContextMenu.draw(x, y, target)
    } else if (waveform.clipViewAt(sample)) {
      waveform.openClipContextMenu(x, y, target)
    } else {
      this.trackList.timelineUnselectionContextMenu.draw(x, y, target)
    }
  }
}

function setAttributeIfChanged(element: HTMLElement, name: string, value: string) {
  if (element.getAttribute(name) !== value) {
    element.setAttribute(name, value)
  }
}
