import { AudioControl, AudioState } from '../audiocontext/AudioControl'
import { TimeUtils } from '../global/TimeUtils'
import type { SelectedRegion } from '../playback/Player'
import type { ClipView } from '../project/ClipView'
import { restoreRemovedAudio, rippleCrossfadeSamples, type RemovedAudio } from '../project/TimelineEdit'
import type { Track } from '../project/Track'
import type { TranscribedRange } from '../project/Transcription'
import {
  replaceTranscriptionRanges,
  transcriptionRangesEqual,
  type TranscriptionReplacement,
} from '../transcription/TranscriptionSelection'
import { TranscriptEditDialogController } from './TranscriptEditDialogController'
import { announce } from './LiveAnnouncer'
import { NotificationsController } from './NotificationsController'
import type { TrackListController } from './timeline/TrackListController'
import { formatTranscriptGap, formatTranscriptParagraph } from './transcript/TranscriptFormatting'
import {
  getTrackTranscriptEntries,
  getTranscriptEntriesInRange,
  splitTranscriptParagraphs,
  type TrackTranscriptEntry,
} from './transcript/TrackTranscript'
import { getTranscriptTextEdits } from './transcript/TranscriptTextEdit'
import { BatchCommand, SetClipTranscriptionCommand } from './undo/UndoableActions'

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
  private readonly playingBindings = new Set<Binding>()
  private nextPlaybackIndex = 0
  private lastPlaybackSample: number | null = null
  private firstPlayingElement: HTMLSpanElement | null = null
  private keyboardAnchor: number | null = null
  private readonly selectionMenu = document.createElement('div')
  private readonly editButton = document.createElement('button')
  private readonly audioButton = document.createElement('button')
  private editDialog: TranscriptEditDialogController | null = null
  private applyingEdit = false
  private editingAudio = false

  constructor(private readonly trackListController: TrackListController) {
    this.selectionMenu.className = 'transcript-selection-menu'
    this.selectionMenu.hidden = true
    this.selectionMenu.setAttribute('role', 'toolbar')
    this.selectionMenu.setAttribute('aria-label', 'Transcript selection actions')
    this.editButton.textContent = 'Edit text'
    this.editButton.setAttribute('aria-keyshortcuts', 'F2')
    this.editButton.addEventListener('click', () => this.openEditDialog())
    this.audioButton.setAttribute('aria-keyshortcuts', 'Backspace Delete')
    this.audioButton.addEventListener('click', () => void this.deleteOrRestoreAudio())
    for (const button of [this.editButton, this.audioButton]) {
      button.type = 'button'
      button.className = 'clickable'
      button.addEventListener('mousedown', (event) => event.preventDefault())
    }
    this.selectionMenu.append(this.editButton, this.audioButton)
    document.body.append(this.selectionMenu)
  }

  get track(): Track | null {
    return this.activeTrack
  }

  /** Shows `track`'s transcript in the returned element, which stays live until `deactivate`. */
  activate(track: Track): HTMLElement {
    if (this.activeTrack !== track || !this.content) {
      this.deactivate()
      this.activeTrack = track
      this.content = document.createElement('section')
      this.content.id = 'transcript-panel-content'
      this.content.tabIndex = 0
      this.lifetime = new AbortController()
      this.listen(this.lifetime.signal)
    }
    this.refreshData()
    this.syncPlayback()
    return this.content
  }

  /** Selects one placed occurrence and scrolls it toward the middle; the content must be on screen. */
  selectEntry(entry: TrackTranscriptEntry): void {
    const binding = this.bindings.find(
      (b) =>
        !b.entry.removed &&
        b.entry.clipView === entry.clipView &&
        b.entry.placementIndex === entry.placementIndex &&
        b.entry.rangeIndex === entry.rangeIndex,
    )
    if (binding) {
      this.selectNativeRange(binding, binding)
      binding.element.scrollIntoView({ block: 'center', inline: 'nearest' })
    }
    this.updateSelectionMenu()
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
    this.selectionMenu.hidden = true
    if (!this.applyingEdit) this.editDialog?.close()
    this.trackListController.pointerStateManager.finishSelectingTranscript()
    this.clearOwnedNativeSelection()
    this.clearPlayback()
    this.trackName = track.name
    this.snapshot = views.map((clipView) => ({
      clipView,
      length: clipView.length,
      transcription: clipView.clip.transcription,
      transcriptionLength: clipView.clip.transcription.length,
    }))
    this.content.setAttribute('aria-label', `Transcript for ${track.name}`)
    const bindings: Binding[] = []
    const sampleRate = this.trackListController.sampleRate
    const paragraphs = splitTranscriptParagraphs(getTrackTranscriptEntries(track, true)).map((entries) => {
      const paragraph = document.createElement('p')
      // Formatting reads what plays; removed words keep their raw text.
      const words = formatTranscriptParagraph(
        entries.filter((entry) => entry.kind === undefined && !entry.removed),
        sampleRate,
      )
      let wordIndex = 0
      // Each run of removed atoms, with the spaces between them, is one <del>.
      let removedRun: HTMLModElement | null = null
      entries.forEach((entry, i) => {
        if (!entry.removed) removedRun = null
        if (i > 0) (removedRun ?? paragraph).append(' ')
        if (entry.removed && !removedRun) removedRun = paragraph.appendChild(document.createElement('del'))
        const element = document.createElement('span')
        ;(removedRun ?? paragraph).append(element)
        if (entry.kind === undefined) {
          element.className = 'transcript-word'
          if (entry.removed) {
            element.textContent = entry.text
          } else {
            const word = words[wordIndex++]
            element.textContent = word.text
            if (word.punctuation) paragraph.append(word.punctuation)
          }
        } else {
          element.className = `transcript-gap transcript-${entry.kind}`
          const duration = entry.removed
            ? entry.removed.sourceEndSample - entry.removed.sourceStartSample
            : entry.endSample - entry.startSample
          element.textContent = formatTranscriptGap(entry.kind, duration, sampleRate)
        }
        bindings.push({ entry, element })
      })
      return paragraph
    })
    this.bindings = bindings
    if (paragraphs.length === 0) {
      const empty = document.createElement('p')
      empty.textContent = 'No transcript on this track.'
      paragraphs.push(empty)
    }
    this.content.replaceChildren(...paragraphs)
    this.firstHighlighted = null
    this.syncSelection(this.trackListController.selectedRegion)
    this.syncPlayback()
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
    this.updateSelectionMenu()
  }

  syncPlayback(position?: number): void {
    if (!this.activeTrack) return
    if (!this.trackListController.canEdit()) this.selectionMenu.hidden = true
    const sample = AudioControl.isPlaying() ? (position ?? AudioControl.audioContext?.getPosition()) : undefined
    if (sample === undefined) {
      this.clearPlayback()
      return
    }
    if (this.lastPlaybackSample !== null && sample < this.lastPlaybackSample) this.clearPlayback()
    this.lastPlaybackSample = sample

    let first: HTMLSpanElement | null = null
    for (const binding of this.playingBindings) {
      if (binding.entry.endSample <= sample) {
        binding.element.classList.remove('playing')
        binding.element.removeAttribute('aria-current')
        this.playingBindings.delete(binding)
      } else {
        first ??= binding.element
      }
    }
    // Bindings are ordered by start time. Advance only past newly reached
    // occurrences; overlapping placements can have more than one active word.
    while (
      this.nextPlaybackIndex < this.bindings.length &&
      this.bindings[this.nextPlaybackIndex].entry.startSample <= sample
    ) {
      const binding = this.bindings[this.nextPlaybackIndex++]
      if (sample < binding.entry.endSample) {
        binding.element.classList.add('playing')
        binding.element.setAttribute('aria-current', 'true')
        this.playingBindings.add(binding)
        first ??= binding.element
      }
    }
    if (!this.gesture) {
      if (first && first !== this.firstPlayingElement) {
        first.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      }
      this.firstPlayingElement = first
    }
  }

  private clearPlayback(): void {
    for (const binding of this.playingBindings) {
      binding.element.classList.remove('playing')
      binding.element.removeAttribute('aria-current')
    }
    this.playingBindings.clear()
    this.nextPlaybackIndex = 0
    this.lastPlaybackSample = null
    this.firstPlayingElement = null
  }

  deactivate(): void {
    // The Tracks tab calls this on every refresh that does not show the transcript.
    if (!this.activeTrack) return
    this.gesture = null
    this.selectionMenu.hidden = true
    this.editDialog?.close()
    this.trackListController.pointerStateManager.finishSelectingTranscript()
    this.clearOwnedNativeSelection()
    this.clearPlayback()
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
        this.selectionMenu.hidden = true
        const element =
          event.target instanceof Element ? event.target.closest('.transcript-word, .transcript-gap') : null
        element?.removeAttribute('tabindex')
        this.gesture = {
          x: event.clientX,
          y: event.clientY,
          moved: false,
          binding: this.bindings.find((b) => b.element === element) ?? null,
        }
        if (this.canWriteSelection()) this.trackListController.pointerStateManager.startSelectingTranscript(event)
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
    this.content!.addEventListener('keydown', (event) => this.handleKeyDown(event), { signal })
    this.content!.addEventListener(
      'focusout',
      (event) => {
        // Only the keyboard-focused atom is focusable; nested focus targets
        // otherwise prevent native drag selection in Chromium.
        if (event.target instanceof HTMLSpanElement) event.target.removeAttribute('tabindex')
      },
      { signal },
    )
    document.addEventListener(
      'mousedown',
      (event) => {
        if (
          event.target instanceof Node &&
          !this.content?.contains(event.target) &&
          !this.selectionMenu.contains(event.target)
        )
          this.selectionMenu.hidden = true
      },
      { signal },
    )
    window.addEventListener('resize', () => (this.selectionMenu.hidden = true), { signal })
    window.addEventListener('scroll', () => (this.selectionMenu.hidden = true), { signal, capture: true })
    window.addEventListener(
      'blur',
      () => {
        this.gesture = null
        this.selectionMenu.hidden = true
        this.trackListController.pointerStateManager.finishSelectingTranscript()
      },
      { signal },
    )
    document.addEventListener(
      'selectionchange',
      () => {
        if (this.gesture || this.publishing) return
        this.updateSelectionMenu()
        if (!this.content?.contains(document.activeElement)) return
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
    this.updateSelectionMenu()
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
        this.seekTo(gesture.binding)
      }
    } finally {
      this.gesture = null
      this.trackListController.pointerStateManager.finishSelectingTranscript()
      this.updateSelectionMenu()
    }
  }

  private seekTo(binding: Binding): void {
    const sample = binding.entry.startSample
    if (this.canWriteSelection()) {
      this.trackListController.clearSelection()
      AudioControl.startPosition = sample
    }
    this.reveal(sample)
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.selectionMenu.hidden = true
      return
    }
    if (event.key === 'F2' && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault()
      this.openEditDialog()
      return
    }
    if ((event.key === 'Backspace' || event.key === 'Delete') && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault()
      void this.deleteOrRestoreAudio()
      return
    }
    const bindings = this.bindings
    if (event.altKey || event.ctrlKey || event.metaKey || bindings.length === 0) return
    const current = bindings.findIndex((b) => b.element === document.activeElement)
    if ((event.key === 'Enter' || event.key === ' ') && current >= 0) {
      event.preventDefault()
      this.seekTo(bindings[current])
      return
    }
    const last = bindings.length - 1
    const initial =
      current < 0
        ? Math.max(
            0,
            bindings.findIndex((b) => b.element.classList.contains('playing')),
          )
        : -1
    let next: number
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = current < 0 ? initial : Math.min(last, current + 1)
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        next = current < 0 ? initial : Math.max(0, current - 1)
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = last
        break
      default:
        return
    }
    event.preventDefault()
    bindings[next].element.tabIndex = -1
    bindings[next].element.focus()
    if (event.shiftKey) {
      const anchor = (this.keyboardAnchor ??= current < 0 ? next : current)
      const low = Math.min(anchor, next)
      const high = Math.max(anchor, next)
      this.selectNativeRange(bindings[low], bindings[high], next < anchor)
      this.publish(bindings.slice(low, high + 1))
    } else {
      this.keyboardAnchor = null
    }
  }

  private canWriteSelection(): boolean {
    const state = AudioControl.getState()
    return state === AudioState.STOPPED || state === AudioState.MONITORING || state === AudioState.MONITORING_PAUSED
  }

  private publish(atoms: Binding[]): void {
    if (!this.canWriteSelection() || !this.activeTrack) return
    // Removed atoms play nowhere, so only the others select timeline audio.
    const words = atoms.filter(({ entry }) => !entry.removed)
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

  private updateSelectionMenu(): void {
    const selection = document.getSelection()
    this.selectionMenu.hidden = true
    if (
      this.gesture ||
      !this.content?.isConnected ||
      !this.trackListController.canEdit() ||
      document.querySelector('dialog[open]') ||
      !this.ownsSelection(selection) ||
      selection.isCollapsed
    )
      return
    const range = selection.getRangeAt(0)
    const atoms = this.wordsInRange(range)
    if (atoms.length === 0) return
    const playing = atoms.some(({ entry }) => !entry.removed)
    this.editButton.hidden = !playing
    this.audioButton.textContent = playing ? 'Delete audio' : 'Restore audio'
    const bounds = range.getBoundingClientRect()
    const contentBounds = this.content.getBoundingClientRect()
    if (bounds.bottom < contentBounds.top || bounds.top > contentBounds.bottom) return
    this.selectionMenu.hidden = false
    const menuBounds = this.selectionMenu.getBoundingClientRect()
    const left = Math.max(
      8,
      Math.min(bounds.left + (bounds.width - menuBounds.width) / 2, window.innerWidth - menuBounds.width - 8),
    )
    const top =
      bounds.top - menuBounds.height - 8 >= contentBounds.top
        ? bounds.top - menuBounds.height - 8
        : Math.min(bounds.bottom + 8, window.innerHeight - menuBounds.height - 8)
    this.selectionMenu.style.left = `${left}px`
    this.selectionMenu.style.top = `${top}px`
  }

  private openEditDialog(): void {
    if (!this.trackListController.canEdit() || !this.activeTrack) return
    const selection = document.getSelection()
    const words = this.selectedAtoms().filter(({ entry }) => !entry.removed)
    const range = this.ownsSelection(selection) ? selection.getRangeAt(0) : null
    const backwards =
      !!range &&
      !range.collapsed &&
      range.startContainer === selection?.focusNode &&
      range.startOffset === selection.focusOffset
    const selectedPlacements = new Map<number, { clipView: ClipView; startSample: number; endSample: number }>()
    for (const { entry } of words) {
      const interval = selectedPlacements.get(entry.placementIndex)
      if (interval) {
        interval.startSample = Math.min(interval.startSample, entry.startSample)
        interval.endSample = Math.max(interval.endSample, entry.endSample)
      } else {
        selectedPlacements.set(entry.placementIndex, {
          clipView: entry.clipView,
          startSample: entry.startSample,
          endSample: entry.endSample,
        })
      }
    }
    const edits = getTranscriptTextEdits(words.map((binding) => binding.entry))
    if (edits.length === 0) return
    const track = this.activeTrack
    const views = [...track.clipViews]
    const originals = new Map(edits.map((edit) => [edit.clip, edit.clip.transcription]))
    this.selectionMenu.hidden = true
    this.content!.focus({ preventScroll: true })
    this.editDialog ??= new TranscriptEditDialogController()
    this.editDialog.open(
      edits,
      this.trackListController.sampleRate,
      async (texts) => {
        if (
          !this.trackListController.canEdit() ||
          this.activeTrack !== track ||
          track.clipViews.length !== views.length ||
          !views.every((view, index) => track.clipViews[index] === view) ||
          ![...originals].every(([clip, ranges]) => clip.transcription === ranges)
        )
          throw new Error('The transcript changed. Close this dialog and select the text again.')

        const replacementsByClip = new Map<(typeof edits)[number]['clip'], TranscriptionReplacement[]>()
        edits.forEach((edit, index) => {
          const text = texts[index].replace(/\r\n?/g, '\n').trim()
          if (text === edit.text) return
          const replacements = replacementsByClip.get(edit.clip) ?? []
          replacements.push({
            startSample: edit.startSample,
            endSample: edit.endSample,
            ranges: text
              ? [
                  {
                    text,
                    startSample: edit.startSample,
                    endSample: edit.endSample,
                    ...(edit.speechStartSample === undefined ? {} : { speechStartSample: edit.speechStartSample }),
                  },
                ]
              : [],
          })
          replacementsByClip.set(edit.clip, replacements)
        })
        const commands: SetClipTranscriptionCommand[] = []
        for (const [clip, replacements] of replacementsByClip) {
          const ranges = replaceTranscriptionRanges(clip.transcription, replacements)
          if (!transcriptionRangesEqual(clip.transcription, ranges))
            commands.push(new SetClipTranscriptionCommand(clip, clip.transcription, ranges))
        }
        if (commands.length === 0) {
          announce('Transcript text was unchanged.')
          return
        }
        this.applyingEdit = true
        try {
          await this.trackListController.history.execute(new BatchCommand(commands, 'edit transcript text'))
          announce('Transcript text updated. Audio and alignment were unchanged.')
        } finally {
          this.applyingEdit = false
        }
      },
      () => {
        if (this.activeTrack !== track) return
        // Resolve fresh atoms: applying an edit replaces the transcript DOM.
        const selected = this.bindings.filter(({ entry }) => {
          const interval = selectedPlacements.get(entry.placementIndex)
          return (
            interval?.clipView === entry.clipView &&
            entry.startSample < interval.endSample &&
            entry.endSample > interval.startSample
          )
        })
        if (selected.length > 0) this.selectNativeRange(selected[0], selected[selected.length - 1], backwards)
        else this.clearOwnedNativeSelection()
      },
    )
  }

  /** The atoms under the panel's native selection, or else the keyboard-focused atom. */
  private selectedAtoms(): Binding[] {
    const selection = document.getSelection()
    const atoms = this.ownsSelection(selection) ? this.wordsInRange(selection.getRangeAt(0)) : []
    if (atoms.length > 0) return atoms
    const focused = this.bindings.find((binding) => binding.element === document.activeElement)
    return focused ? [focused] : []
  }

  /**
   * Ripple-deletes the audio from the first to the last selected atom that plays. A selection of
   * removed atoms alone plays their audio again instead.
   */
  private async deleteOrRestoreAudio(): Promise<void> {
    const track = this.activeTrack
    if (!track || this.editingAudio || !this.trackListController.canEdit()) return
    // Rebuilds stale atoms, dropping their selection, so edits only ever see current placements.
    this.refreshData()
    const atoms = this.selectedAtoms()
    if (atoms.length === 0) return
    const keyboardFocused = this.bindings.some((binding) => binding.element === document.activeElement)
    const playing = atoms.filter(({ entry }) => !entry.removed)
    this.editingAudio = true
    this.selectionMenu.hidden = true
    this.content!.focus({ preventScroll: true })
    try {
      if (playing.length > 0) await this.deleteAudio(track, playing, keyboardFocused)
      else await this.restoreAudio(track, atoms, keyboardFocused)
    } catch (error) {
      NotificationsController.showError(error instanceof Error ? error : new Error(String(error)))
    } finally {
      this.editingAudio = false
    }
  }

  private async deleteAudio(track: Track, atoms: Binding[], focus: boolean): Promise<void> {
    let start = Infinity
    let end = -Infinity
    for (const { entry } of atoms) {
      start = Math.min(start, entry.startSample)
      end = Math.max(end, entry.endSample)
    }
    const sources = atoms.map(({ entry: { clipView, startSample, endSample } }) => ({
      clip: clipView.clip,
      startSample: clipView.offset + startSample - clipView.startPosition,
      endSample: clipView.offset + endSample - clipView.startPosition,
    }))
    const sampleRate = this.trackListController.sampleRate
    // Other tracks follow the editing settings, so a conversation on separate tracks can stay in sync.
    const layouts = this.trackListController.planCut([track], start, end, true)
    if (!layouts) return
    this.trackListController.clearSelection()
    AudioControl.startPosition = start
    await this.trackListController.executeLayouts(layouts, 'delete audio')
    const others = [...layouts.keys()].filter((changed) => changed !== track).length
    announce(
      `Deleted ${TimeUtils.toSpokenString(((end - start) * 1000) / sampleRate)} of audio` +
        (others == 0 ? '' : `, also on ${others} other ${others == 1 ? 'track' : 'tracks'}`),
    )
    if (this.activeTrack !== track) return
    // Selecting what was just taken out lets Backspace put it straight back.
    this.selectAtoms(
      this.bindings.filter(({ entry: { clipView, startSample, removed } }) => {
        return (
          !!removed &&
          startSample === start &&
          sources.some(
            (source) =>
              source.clip === clipView.clip &&
              removed.sourceStartSample < source.endSample &&
              removed.sourceEndSample > source.startSample,
          )
        )
      }),
      focus,
    )
    this.reveal(start)
  }

  private async restoreAudio(track: Track, atoms: Binding[], focus: boolean): Promise<void> {
    // One span per seam, from the first to the last selected atom removed there.
    const spans = new Map<RemovedAudio, { sourceStartSample: number; sourceEndSample: number }>()
    for (const { entry } of atoms) {
      const removed = entry.removed
      if (!removed) continue
      const span = spans.get(removed.audio)
      if (span) {
        span.sourceStartSample = Math.min(span.sourceStartSample, removed.sourceStartSample)
        span.sourceEndSample = Math.max(span.sourceEndSample, removed.sourceEndSample)
      } else {
        spans.set(removed.audio, {
          sourceStartSample: removed.sourceStartSample,
          sourceEndSample: removed.sourceEndSample,
        })
      }
    }
    const ordered = [...spans].sort(([a], [b]) => a.index - b.index)
    const sampleRate = this.trackListController.sampleRate
    const crossfade = rippleCrossfadeSamples(sampleRate)
    const layouts = new Map<Track, ClipView[]>()
    let clipViews = track.clipViews
    // Later seams first, so each earlier seam keeps its position and placement indices.
    for (let index = ordered.length - 1; index >= 0; --index) {
      const [audio, span] = ordered[index]
      const length = span.sourceEndSample - span.sourceStartSample
      clipViews = restoreRemovedAudio(clipViews, audio, span.sourceStartSample, span.sourceEndSample, crossfade)
      const offset = span.sourceStartSample - audio.sourceStartSample
      if (!this.trackListController.planGapReopen(track, audio.seamSample, offset, length, layouts)) return
    }
    layouts.set(track, clipViews)
    // Each restore pushes the later seams back by what it put back.
    let pushed = 0
    const restored = ordered.map(([audio, span]) => {
      const startSample = audio.seamSample + pushed
      pushed += span.sourceEndSample - span.sourceStartSample
      return { startSample, endSample: audio.seamSample + pushed }
    })
    this.trackListController.clearSelection()
    await this.trackListController.executeLayouts(layouts, 'restore audio')
    const others = layouts.size - 1
    announce(
      `Restored ${TimeUtils.toSpokenString((pushed * 1000) / sampleRate)} of audio` +
        (others == 0 ? '' : `, also on ${others} other ${others == 1 ? 'track' : 'tracks'}`),
    )
    if (this.activeTrack !== track) return
    const words = this.bindings.filter(
      ({ entry }) =>
        !entry.removed &&
        restored.some((range) => entry.startSample < range.endSample && entry.endSample > range.startSample),
    )
    this.selectAtoms(words, focus)
    this.publish(words)
  }

  /** Selects `atoms` natively, from the first to the last, leaving the timeline selection alone. */
  private selectAtoms(atoms: Binding[], focus: boolean): void {
    this.keyboardAnchor = null
    if (atoms.length === 0) return
    if (focus) {
      atoms[0].element.tabIndex = -1
      atoms[0].element.focus({ preventScroll: true })
    }
    this.selectNativeRange(atoms[0], atoms[atoms.length - 1])
    atoms[0].element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  private reveal(sample: number): void {
    this.trackListController.goToSample(sample)
    this.trackListController.waveforms.find((w) => w.track === this.activeTrack)?.revealTranscriptLane()
  }
}
