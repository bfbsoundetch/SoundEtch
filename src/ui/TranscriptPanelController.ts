import { AudioControl, AudioState } from '../audiocontext/AudioControl'
import type { SelectedRegion } from '../playback/Player'
import type { ClipView } from '../project/ClipView'
import type { Track } from '../project/Track'
import type { TranscribedRange } from '../project/Transcription'
import { BottomPanelController } from './BottomPanelController'
import type { TrackListController } from './timeline/TrackListController'
import {
  getTrackTranscriptEntries,
  getTranscriptEntriesInRange,
  type TrackTranscriptEntry,
} from './transcript/TrackTranscript'

type Binding = { entry: TrackTranscriptEntry; element: HTMLSpanElement }
type Snapshot = {
  clipView: ClipView
  length: number
  transcription: readonly TranscribedRange[]
  transcriptionLength: number
}
type Gesture = { x: number; y: number; moved: boolean; binding: Binding | null }
type NativeEndpoints = { anchor: Node | null; anchorOffset: number; focus: Node | null; focusOffset: number }

export class TranscriptPanelController {
  private readonly shell = BottomPanelController.getInstance()
  private activeTrack: Track | null = null
  private content: HTMLElement | null = null
  private bindings: Binding[] = []
  private snapshot: Snapshot[] = []
  private trackName = ''
  private lifetime: AbortController | null = null
  private gesture: Gesture | null = null
  private publishing = false
  private ignoredSelection: NativeEndpoints | null = null
  private firstHighlighted: HTMLSpanElement | null = null

  constructor(private readonly trackListController: TrackListController) {}

  get track(): Track | null {
    return this.activeTrack
  }

  open(track: Track, entry: TrackTranscriptEntry): void {
    if (this.activeTrack !== track) {
      this.deactivate()
      this.activeTrack = track
      this.content = document.createElement('section')
      this.content.id = 'transcript-panel-content'
      this.content.tabIndex = 0
      this.lifetime = new AbortController()
      this.listen(this.lifetime.signal)
    }
    this.refreshData()
    this.shell.open({
      owner: this,
      title: 'Transcript',
      subtitle: track.name,
      body: this.content!,
      onClose: () => this.deactivate(),
    })
    const binding = this.bindings.find(
      (b) =>
        b.entry.clipView === entry.clipView &&
        b.entry.placementIndex === entry.placementIndex &&
        b.entry.rangeIndex === entry.rangeIndex,
    )
    if (binding) {
      this.publish([binding])
      this.selectNativeRange(binding, binding)
      binding.element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  }

  close(): void {
    this.shell.close(this)
  }

  refreshData(): void {
    const track = this.activeTrack
    if (!track || !this.content) return
    const views = track.clipViews
    if (
      this.trackName === track.name &&
      this.snapshot.length === views.length &&
      this.snapshot.every(
        (old, i) =>
          old.clipView === views[i] &&
          old.length === views[i].length &&
          old.transcription === views[i].clip.transcription &&
          old.transcriptionLength === views[i].clip.transcription.length,
      ) &&
      this.content.hasChildNodes()
    )
      return
    this.gesture = null
    this.trackListController.pointerStateManager.finishSelectingTranscript()
    this.clearOwnedNativeSelection()
    this.trackName = track.name
    this.snapshot = views.map((clipView) => ({
      clipView,
      length: clipView.length,
      transcription: clipView.clip.transcription,
      transcriptionLength: clipView.clip.transcription.length,
    }))
    this.content.setAttribute('aria-label', `Transcript for ${track.name}`)
    this.shell.setSubtitle(track.name)
    const paragraph = document.createElement('p')
    this.bindings = getTrackTranscriptEntries(track).map((entry, i) => {
      const element = document.createElement('span')
      element.className = 'transcript-word'
      element.textContent = entry.text
      if (i > 0) paragraph.append(' ')
      paragraph.append(element)
      return { entry, element }
    })
    if (this.bindings.length === 0) paragraph.textContent = 'No transcript on this track.'
    this.content.replaceChildren(paragraph)
    this.firstHighlighted = null
    this.syncSelection(this.trackListController.selectedRegion)
  }

  syncSelection(selection: SelectedRegion | null): void {
    if (!this.activeTrack) return
    const selected = new Set(
      selection?.tracks.includes(this.activeTrack)
        ? getTranscriptEntriesInRange(
            this.bindings.map((b) => b.entry),
            selection.startSample,
            selection.endSample,
          )
        : [],
    )
    let first: Binding | null = null
    let last: Binding | null = null
    for (const binding of this.bindings) {
      if (!selected.has(binding.entry)) continue
      first ??= binding
      last = binding
    }
    if (!this.gesture && !this.publishing) {
      if (first && last) {
        const nativeSelection = document.getSelection()
        if (nativeSelection && (nativeSelection.rangeCount === 0 || this.ownsSelection(nativeSelection))) {
          this.selectNativeRange(first, last)
        }
      } else {
        this.clearOwnedNativeSelection()
      }
    }
    const firstElement = first?.element ?? null
    if (firstElement && firstElement !== this.firstHighlighted) {
      firstElement.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
    this.firstHighlighted = firstElement
  }

  private deactivate(): void {
    this.gesture = null
    this.trackListController.pointerStateManager.finishSelectingTranscript()
    this.clearOwnedNativeSelection()
    this.lifetime?.abort()
    this.lifetime = null
    this.activeTrack = null
    this.content = null
    this.bindings = []
    this.snapshot = []
    this.firstHighlighted = null
    this.ignoredSelection = null
  }

  private listen(signal: AbortSignal): void {
    this.content!.addEventListener(
      'mousedown',
      (event) => {
        if (event.button !== 0) return
        const element = event.target instanceof Element ? event.target.closest('.transcript-word') : null
        this.gesture = {
          x: event.clientX,
          y: event.clientY,
          moved: false,
          binding: this.bindings.find((b) => b.element === element) ?? null,
        }
        if (this.canWriteSelection()) this.trackListController.pointerStateManager.startSelectingTranscript(event)
        this.content!.focus({ preventScroll: true })
      },
      { signal },
    )
    document.addEventListener(
      'mousemove',
      (event) => {
        if (
          this.gesture &&
          (Math.abs(event.clientX - this.gesture.x) >= 2 || Math.abs(event.clientY - this.gesture.y) >= 2)
        )
          this.gesture.moved = true
      },
      { signal },
    )
    document.addEventListener('mouseup', (event) => this.handleMouseUp(event), { signal })
    window.addEventListener(
      'blur',
      () => {
        this.gesture = null
        this.trackListController.pointerStateManager.finishSelectingTranscript()
      },
      { signal },
    )
    document.addEventListener(
      'selectionchange',
      () => {
        if (this.gesture || this.publishing || !this.content?.contains(document.activeElement)) return
        const selection = document.getSelection()
        if (!this.ownsSelection(selection)) return
        const ignored = this.ignoredSelection
        if (
          ignored &&
          selection.anchorNode === ignored.anchor &&
          selection.anchorOffset === ignored.anchorOffset &&
          selection.focusNode === ignored.focus &&
          selection.focusOffset === ignored.focusOffset
        )
          return
        this.ignoredSelection = null
        this.publish(this.wordsInRange(selection.getRangeAt(0)))
      },
      { signal },
    )
  }

  private ownsSelection(selection: Selection | null): selection is Selection {
    return (
      !!selection &&
      selection.rangeCount === 1 &&
      !!this.content &&
      !!selection.anchorNode &&
      !!selection.focusNode &&
      this.content.contains(selection.anchorNode) &&
      this.content.contains(selection.focusNode)
    )
  }

  private rememberSelection(selection: Selection): void {
    this.ignoredSelection = {
      anchor: selection.anchorNode,
      anchorOffset: selection.anchorOffset,
      focus: selection.focusNode,
      focusOffset: selection.focusOffset,
    }
  }

  private selectNativeRange(first: Binding, last: Binding, backwards = false): void {
    const selection = document.getSelection()
    if (!selection) return
    const start = first.element.firstChild!
    const end = last.element.firstChild!
    const anchor = backwards ? end : start
    const anchorOffset = backwards ? end.textContent!.length : 0
    const focus = backwards ? start : end
    const focusOffset = backwards ? 0 : end.textContent!.length
    if (
      selection.anchorNode !== anchor ||
      selection.anchorOffset !== anchorOffset ||
      selection.focusNode !== focus ||
      selection.focusOffset !== focusOffset
    ) {
      selection.setBaseAndExtent(anchor, anchorOffset, focus, focusOffset)
    }
    this.rememberSelection(selection)
  }

  private clearOwnedNativeSelection(): void {
    const selection = document.getSelection()
    if (!this.ownsSelection(selection)) return
    selection.removeAllRanges()
    this.rememberSelection(selection)
  }

  // Compare collapsed text boundaries: touching a span wrapper is not text overlap.
  private wordsInRange(range: Range): Binding[] {
    if (
      range.collapsed ||
      range.toString().trim().length === 0 ||
      !this.content?.contains(range.startContainer) ||
      !this.content.contains(range.endContainer)
    )
      return []
    const start = range.cloneRange()
    start.collapse(true)
    const end = range.cloneRange()
    end.collapse(false)
    return this.bindings.filter((binding) => {
      const word = document.createRange()
      const text = binding.element.firstChild!
      word.setStart(text, 0)
      word.setEnd(text, text.textContent!.length)
      const wordStart = word.cloneRange()
      wordStart.collapse(true)
      word.collapse(false)
      return (
        word.compareBoundaryPoints(Range.START_TO_START, start) > 0 &&
        wordStart.compareBoundaryPoints(Range.START_TO_START, end) < 0
      )
    })
  }

  private handleMouseUp(event: MouseEvent): void {
    const gesture = this.gesture
    if (!gesture) return
    // Keep reflection from discarding this native range during publication.
    try {
      if (event.button !== 0 || !(event.target instanceof Node) || !this.content?.contains(event.target)) return
      const selection = document.getSelection()
      if (!this.ownsSelection(selection)) return
      const range = selection.getRangeAt(0)
      if (!range.collapsed) {
        const words = this.wordsInRange(range)
        if (words.length > 0) {
          const anchor = document.createRange()
          anchor.setStart(selection.anchorNode!, selection.anchorOffset)
          anchor.collapse(true)
          const focus = document.createRange()
          focus.setStart(selection.focusNode!, selection.focusOffset)
          focus.collapse(true)
          const backwards = anchor.compareBoundaryPoints(Range.START_TO_START, focus) > 0
          this.selectNativeRange(words[0], words[words.length - 1], backwards)
        }
        this.publish(words)
      } else if (!gesture.moved && gesture.binding) {
        const sample = gesture.binding.entry.startSample
        if (this.canWriteSelection()) {
          this.trackListController.clearSelection()
          AudioControl.startPosition = sample
        }
        this.reveal(sample)
      }
    } finally {
      this.gesture = null
      this.trackListController.pointerStateManager.finishSelectingTranscript()
    }
  }

  private canWriteSelection(): boolean {
    const state = AudioControl.getState()
    return state === AudioState.STOPPED || state === AudioState.MONITORING || state === AudioState.MONITORING_PAUSED
  }

  private publish(words: Binding[]): void {
    if (!this.canWriteSelection() || !this.activeTrack) return
    this.publishing = true
    try {
      if (words.length === 0) {
        if (this.trackListController.selectedRegion) this.trackListController.clearSelection()
        return
      }
      let low = Infinity,
        high = -Infinity
      for (const { entry } of words) {
        low = Math.min(low, entry.startSample)
        high = Math.max(high, entry.endSample)
      }
      const waveform = this.trackListController.waveforms.find((w) => w.track === this.activeTrack)
      if (!waveform) return
      const current = this.trackListController.selectedRegion
      if (
        current?.startSample === low &&
        current.endSample === high &&
        current.tracks.length === 1 &&
        current.tracks[0] === this.activeTrack
      ) {
        this.trackListController.positionMarkerController.hidePositionMarker()
        return
      }
      this.trackListController.selectionController.setSelection(low, high, new Set([waveform]))
      this.reveal(low)
    } finally {
      this.publishing = false
    }
  }

  private reveal(sample: number): void {
    this.trackListController.goToSample(sample)
    this.trackListController.waveforms.find((w) => w.track === this.activeTrack)?.revealTranscriptLane()
  }
}
