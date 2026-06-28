import { ProjectManager } from '../../project/ProjectManager'
import { ClipViewController, Waveform } from './Waveform'
import { TimelineController } from './TimelineController'
import { PositionMarkerController } from './PositionMarkerController'
import { AudioControl, AudioState } from '../../audiocontext/AudioControl'
import { KeyPressController } from '../KeyPressController'
import { ContextMenuController, ContextMenuItem } from '../ContextMenuController'
import { PointerStateManager } from '../PointerStateManager'
import { ClipView, cloneClipViewWithNewStartPosition } from '../../project/ClipView'
import { Clipboard } from '../Clipboard'
import { TrackListTrack as TrackListInfo } from './TrackListTrack'
import { InputListController } from './InputListController'
import { SelectedRegion } from '../../playback/Player'
import { editorHistory } from '../undo/EditorHistory'
import { EffectType } from '../../effects/Effects'
import {
  AddClipViewCommand,
  BatchCommand,
  MoveClipViewBetweenTracksCommand,
  SetTrackClipViewsCommand,
} from '../undo/UndoableActions'
import { Track } from '../../project/Track'
import { TimelineRegionController } from './TimelineRegionController'

interface Selection {
  startSample: number
  endSample: number
  waveforms: Set<Waveform>
}

export class TrackListController {
  private msPerUnit = Infinity
  private translationUnits = 0
  sampleRate = 0 // will be set before anything is rendered

  get msScale() {
    return this.msPerUnit
  }

  get sampleScale() {
    return (this.msPerUnit * this.sampleRate) / 1000
  }

  get translation() {
    return this.translationUnits
  }

  get width() {
    return this.tracklistElement.clientWidth
  }

  get height() {
    return this.timelineController.getHeight() + this.tracklistElement.clientHeight
  }

  get selectedRegion(): SelectedRegion | null {
    return this.selectionController.selectedRegion
  }

  readonly waveforms = new Array<Waveform>()
  readonly timelineController = new TimelineController(this)
  readonly inputListController = new InputListController()
  readonly positionMarkerController = new PositionMarkerController(this)
  readonly history = editorHistory
  readonly pointerStateManager = new PointerStateManager(this)
  readonly selectionController = new TimelineRegionController(
    false,
    (event: PointerEvent) => this.timelineSelectionContextMenu.draw(event.clientX, event.clientY),
    () => {},
    this,
  )

  private readonly activeTrackEffects = new Map<number, EffectType | null>()
  private readonly tracklistElement = document.getElementById('track-list')!
  private readonly tracklistInfoElement = document.getElementById('track-info-list')!
  private readonly infoWaveformPairs = new Map<
    string,
    { info: HTMLElement; waveform: HTMLElement; controller: Waveform }
  >()
  private renderedProjectId: number | undefined = undefined

  readonly timelineSelectionContextMenu = new ContextMenuController(
    'timeline-selection-contextmenu',
    this.pointerStateManager,
    new ContextMenuItem('Cut', () => this.sliceSelection(true)),
    new ContextMenuItem('Copy', () => this.sliceSelection(false)),
    new ContextMenuItem('Paste', (activeTrackIndex, startSample) => this.paste(activeTrackIndex, startSample)),
    new ContextMenuItem('Effect...', () => {}),
  )

  private readonly timelineUnselectionContextMenu = new ContextMenuController(
    'timeline-unselection-contextmenu',
    this.pointerStateManager,
    new ContextMenuItem('Paste', (activeTrackIndex, startSample) => this.paste(activeTrackIndex, startSample)),
  )

  private readonly cursorPoint = new DOMPoint()
  mouseEventToSvgCoord(event: MouseEvent): DOMPoint {
    this.cursorPoint.x = event.clientX
    this.cursorPoint.y = event.clientY
    return this.cursorPoint.matrixTransform(this.positionMarkerController.positionMarkerSvg.getScreenCTM()!.inverse())
  }

  mouseXToSvgCoord(x: number): number {
    this.cursorPoint.x = x
    this.cursorPoint.y = 1
    const result = this.cursorPoint.matrixTransform(
      this.positionMarkerController.positionMarkerSvg.getScreenCTM()!.inverse(),
    ).x
    return result
  }

  private zoom(wheelEvent: WheelEvent) {
    if (wheelEvent.deltaY == 0) {
      return
    }
    const scaling = 1.01 ** wheelEvent.deltaY
    if (this.msPerUnit * scaling < 0.001) {
      return
    }
    this.msPerUnit *= scaling

    // t + x = (t + x - n) * s
    // t + x = st + sx - sn
    // sn = (s-1)(t+x)
    // n = (t + x)(s - 1) / s
    this.translationUnits -=
      ((this.translationUnits + this.mouseEventToSvgCoord(wheelEvent).x) * (scaling - 1)) / scaling

    this.translationUnits = Math.max(this.translationUnits, 0)
    this.draw()
  }

  private translate(units: number) {
    if (units == 0 || (this.translationUnits == 0 && units < 0)) {
      return
    }
    this.translationUnits += Math.round(units)
    if (this.translationUnits < 0) {
      this.translationUnits = 0
    }
    this.draw()
  }

  constructor() {
    this.history.addChangeListener(() => this.draw())
    KeyPressController.addKeyDownListener((event) => this.handleKeyDown(event))

    new ResizeObserver(async (_) => {
      this.timelineController.resize()
      this.waveforms.forEach((w) => w.resize())
      this.positionMarkerController.resize()
      if (!Number.isFinite(this.msPerUnit)) {
        const project = await ProjectManager.getActiveProject()
        const length =
          Number.isFinite(project.getLength()) && project.getLength() > 0 ? project.getLength() : 15 * this.sampleRate
        this.msPerUnit = (length * 1.1 * 1000) / this.sampleRate / this.width
      }
      this.selectionController.resize()
      this.draw()
    }).observe(this.tracklistElement)

    AudioControl.addAudioControlListener((state) => {
      switch (state) {
        case AudioState.PLAYING:
        case AudioState.RECORDING:
          this.translateToFollowPosition(0, this)
          break
      }
    })

    ProjectManager.addProjectListener((project) => {
      this.sampleRate = project.sampleRate
      if (this.renderedProjectId != project.id) {
        this.renderedProjectId = project.id
        this.msPerUnit = Infinity
        this.translationUnits = 0
        this.waveforms.splice(0)
        this.infoWaveformPairs.clear()
        this.activeTrackEffects.clear()
        this.clearSelection()
      }

      const infoDivs = new Array<Node>()
      const waveformDivs = new Array<Node>()
      const nextWaveforms = new Array<Waveform>()
      const trackIds = new Set(project.getTracks().map((track) => `${track.id}`))
      for (const trackId of this.infoWaveformPairs.keys()) {
        if (!trackIds.has(trackId)) {
          this.infoWaveformPairs.delete(trackId)
        }
      }

      for (let i = 0; i < project.getTracks().length; ++i) {
        const track = project.getTracks()[i]
        const existing = this.infoWaveformPairs.get(`${track.id}`)
        if (existing && existing.controller.index == i) {
          infoDivs.push(existing.info)
          waveformDivs.push(existing.waveform)
          nextWaveforms.push(existing.controller)
          continue
        }

        const trackInfoDiv = document.createElement('div')
        trackInfoDiv.style.height = `${7 * track.getChannelCount() + 1.5}rem`
        const trackListInfo = new TrackListInfo(track, trackInfoDiv, this.history, (changedTrack, effect) => {
          
        })

        const waveformDiv = document.createElement('div')
        waveformDiv.addEventListener('contextmenu', (mouseEvent) => {
          mouseEvent.preventDefault()
          this.timelineUnselectionContextMenu.draw(mouseEvent.clientX, mouseEvent.clientY)
        })
        waveformDiv.style.height = `${7 * track.getChannelCount() + 1.5}rem`
        waveformDiv.id = `waveform-track-${track.id}`
        this.tracklistInfoElement.appendChild(trackInfoDiv)
        this.tracklistElement.appendChild(waveformDiv)

        // const trackPeakMeterController = new PeakMeterController(trackPeakMeterDiv)

        const waveform = new Waveform(this, track, waveformDiv, i)
        nextWaveforms.push(waveform)
        this.infoWaveformPairs.set(`${track.id}`, { info: trackInfoDiv, waveform: waveformDiv, controller: waveform })

        infoDivs.push(trackInfoDiv)
        waveformDivs.push(waveformDiv)
      }
      this.waveforms.splice(0, this.waveforms.length, ...nextWaveforms)
      this.tracklistInfoElement.replaceChildren(...infoDivs)
      this.tracklistElement.replaceChildren(...waveformDivs)
      this.waveforms.forEach((waveform) => waveform.draw())
      this.selectionController.remove()
      this.pointerStateManager
    })
  }

  selectTrack(waveform: Waveform) {
    this.selectionController.setSelection(0, waveform.track.length, new Set([waveform]))
  }

  selectClipView(clipView: ClipView, waveform: Waveform) {
    this.selectionController.setSelection(clipView.startPosition, clipView.getEndPosition(), new Set([waveform]))
  }

  clearSelection() {
    this.selectionController.remove()
  }

  getDisplayedEffectForTrack(track: Track): EffectType | null {
    return this.activeTrackEffects.get(track.id ?? -1) ?? null
  }

  async transferClipViewBetweenTracks(clipViewController: ClipViewController, newWaveform: Waveform, shift: number) {
    const oldWaveform = clipViewController.waveform
    const newTrack = newWaveform.track
    const oldClipView = oldWaveform.track.clipViews[clipViewController.clipViewIndex]
    const clipView = cloneClipViewWithNewStartPosition(oldClipView, shift)
    if (!newTrack.canAddClipView(clipView)) {
      clipViewController.reset()
      return
    }
    await this.history.execute(new MoveClipViewBetweenTracksCommand(oldWaveform.track, newTrack, oldClipView, clipView))
  }

  async sliceSelection(del: boolean) {
    const newClipboard: typeof Clipboard.copiedClipViews = []
    const undoCommands: SetTrackClipViewsCommand[] = []
    const selection = this.selectionController.selectedRegion
    if (!selection) { return }
    selection?.tracks.forEach(track => {
      const oldClipViews = track.clipViews.slice()
      newClipboard.push(track.slice(selection.startSample, selection.endSample, del))
      if (del && !this.clipViewArraysEqual(oldClipViews, track.clipViews)) {
        undoCommands.push(new SetTrackClipViewsCommand(track, oldClipViews, track.clipViews.slice()))
      }
    })
    Clipboard.copiedClipViews = newClipboard
    Clipboard.copyStartPosition = selection.startSample
    if (del && undoCommands.length > 0) {
      await this.history.recordApplied(new BatchCommand(undoCommands, del ? 'cut' : 'copy'))
    }
    this.draw()
  }

  async paste(trackIndex: number, startingSample: number) {
    if (!Clipboard.copiedClipViews || Clipboard.copyStartPosition == null) {
      return
    }
    const startPositionDelta = startingSample - Clipboard.copyStartPosition
    const tracks = (await ProjectManager.getActiveProject()).getTracks()
    const undoCommands: AddClipViewCommand[] = []
    let i = 0
    for (const clipViews of Clipboard.copiedClipViews) {
      const track = tracks[trackIndex + i++]
      if (!track) {
        continue
      }
      for (const clipView of clipViews) {
        const newClipView = cloneClipViewWithNewStartPosition(clipView, startPositionDelta)
        if (!track.canAddClipView(newClipView)) {
          return
        }
        undoCommands.push(new AddClipViewCommand(newClipView, track))
      }
    }
    if (undoCommands.length > 0) {
      await this.history.execute(new BatchCommand(undoCommands, 'paste'))
    }
  }

  draw() {
    this.timelineController.draw()
    this.waveforms.forEach((waveform) => waveform.draw())
    this.selectionController.draw()
    this.positionMarkerController.draw()
  }

  private handleKeyDown(event: KeyboardEvent) {
    if (event.defaultPrevented || this.shouldIgnoreKeyboardShortcut(event.target)) {
      return
    }
    const usesModifier = event.metaKey || event.ctrlKey
    if (!usesModifier) {
      return
    }
    if (!event.shiftKey && event.code == 'KeyC') {
      event.preventDefault()
      this.sliceSelection(false)
      return
    }
    if (!event.shiftKey && event.code == 'KeyV') {
      if (!Clipboard.copiedClipViews || Clipboard.copyStartPosition == null) {
        return
      }
      event.preventDefault()
      if (!this.canEdit()) {
        return
      }
      const trackIndex =
        this.pointerStateManager.getActiveTrack()?.index ??
        this.waveforms.find((waveform) => this.selectionController?.isInRegion(waveform))?.index ??
        0
      this.paste(trackIndex, AudioControl.startPosition)
      return
    }
    if (event.code == 'KeyZ') {
      event.preventDefault()
      if (!this.canEdit()) {
        return
      }
      if (event.shiftKey) {
        this.history.redo()
      } else {
        this.history.undo()
      }
      return
    }
    if (event.ctrlKey && event.code == 'KeyY') {
      event.preventDefault()
      if (!this.canEdit()) {
        return
      }
      this.history.redo()
    }
  }

  private canEdit() {
    return AudioControl.getState() == AudioState.STOPPED || AudioControl.getState() == AudioState.MONITORING
  }

  private shouldIgnoreKeyboardShortcut(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) {
      return false
    }
    if (target.isContentEditable || target.tagName == 'TEXTAREA') {
      return true
    }
    if (target instanceof HTMLInputElement) {
      return !['button', 'checkbox', 'radio', 'range', 'reset', 'submit'].includes(target.type)
    }
    return false
  }

  private clipViewArraysEqual(a: ClipView[], b: ClipView[]) {
    return a.length == b.length && a.every((clipView, index) => clipView == b[index])
  }

  private translateToFollowPosition(timestamp: number, controller: TrackListController) {
    if (AudioControl.getState() != AudioState.PLAYING && AudioControl.getState() != AudioState.RECORDING) {
      this.draw()
      return
    }
    requestAnimationFrame((timestamp) => controller.translateToFollowPosition(timestamp, controller))
    const windowMinSamples = controller.translationUnits * this.timelineController.samplesPerUnit
    const windowMaxSamples = windowMinSamples + this.width * this.timelineController.samplesPerUnit
    const position = AudioControl.audioContext!.getPosition()
    if (
      position > windowMinSamples + this.width * 0.8 * this.timelineController.samplesPerUnit &&
      position <= windowMaxSamples
    ) {
      this.translationUnits = Math.floor(position / this.timelineController.samplesPerUnit - this.width * 0.8)
    }
    this.timelineController.draw()
    this.waveforms.forEach((waveform) => waveform.drawAudioData())
    this.selectionController.draw()
    this.positionMarkerController.draw(position)
  }
}
