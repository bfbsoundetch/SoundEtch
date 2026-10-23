import { ProjectManager } from '../../project/ProjectManager'
import { ClipViewController, Waveform } from './Waveform'
import { TimelineController } from './TimelineController'
import { PositionMarkerController } from './PositionMarkerController'
import { AudioControl, AudioState } from '../../audiocontext/AudioControl'
import { KeyPressController } from '../KeyPressController'
import { ContextMenuController, ContextMenuItem, ContextMenuSeparator } from '../ContextMenuController'
import { PointerStateManager } from '../PointerStateManager'
import { ClipView, cloneClipViewWithNewStartPosition } from '../../project/ClipView'
import { Clipboard } from '../Clipboard'
import { TrackListTrack as TrackListInfo } from './TrackListTrack'
import { InputListController } from './InputListController'
import type { SelectedRegion } from '../../playback/Player'
import { editorHistory } from '../undo/EditorHistory'
import {
  AddClipViewCommand,
  BatchCommand,
  MoveClipViewBetweenTracksCommand,
  MoveClipViewToNewTrackCommand,
  SetTrackClipViewsCommand,
  SetClipTranscriptionCommand,
} from '../undo/UndoableActions'
import { Track } from '../../project/Track'
import { TimelineRegionController } from './TimelineRegionController'
import { NotificationsController } from '../NotificationsController'
import { ParameterMetadata } from '../../effects/ParameterMetadata'
import { AutomationController } from './AutomationController'
import { SpectrogramService } from './spectrogram/SpectrogramService'
import type { TrackDisplayMode } from './TrackDisplayMode'
import { TimeEntryDialogController } from './TimeEntryDialogController'
import type { TimeEntryRequest } from './TimeEntryDialogController'
import { TimelineKeyboardController } from './TimelineKeyboardController'
import { announce } from '../LiveAnnouncer'
import { TimeUtils } from '../../global/TimeUtils'
import type { Clip } from '../../project/Clip'
import { Transcriber } from '../../transcription/Transcriber'
import {
  getSelectedClipIntervals,
  replaceTranscriptionRanges,
  transcriptionRangesEqual,
} from '../../transcription/TranscriptionSelection'
import type { TranscriptionReplacement } from '../../transcription/TranscriptionSelection'
import type { ProcessingModalController } from '../ProcessingModalController'
import { TrackPanelController } from '../TrackPanelController'
import { getTrackTranscriptEntries } from '../transcript/TrackTranscript'
import type { TrackTranscriptEntry } from '../transcript/TrackTranscript'

interface Selection {
  startSample: number
  endSample: number
  waveforms: Set<Waveform>
}

interface AutomationMode {
  controller: AutomationController
  infoElement: HTMLElement
  originalInfoElements: Node[]
}

interface TrackListWindow extends Window {
  readonly processingModalController?: ProcessingModalController
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

  rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize)
  // First, so the transcript it owns exists before anything below can draw.
  readonly trackPanelController = new TrackPanelController(this)
  readonly waveforms = new Array<Waveform>()
  readonly timelineController = new TimelineController(this)
  readonly inputListController = new InputListController()
  readonly positionMarkerController = new PositionMarkerController(this)
  readonly history = editorHistory
  readonly pointerStateManager = new PointerStateManager(this)
  readonly selectionController = new TimelineRegionController(
    false,
    (event: PointerEvent) => this.timelineSelectionContextMenu.draw(event.clientX, event.clientY),
    (selection) => {
      this.trackPanelController.transcript.syncSelection(selection)
      this.timelineKeyboard.refresh()
    },
    this,
  )
  readonly timelineKeyboard = new TimelineKeyboardController(this)

  private readonly tracklistElement = document.getElementById('track-list')!
  private readonly tracklistInfoElement = document.getElementById('track-info-list')!
  private readonly newTrackDropRegion = document.createElement('div')
  private readonly resizeCallback
  private readonly infoWaveformPairs = new Map<
    string,
    { info: HTMLElement; waveform: HTMLElement; controller: Waveform; infoController: TrackListInfo }
  >()
  private renderedProjectId: number | undefined = undefined
  private automationMode: AutomationMode | null = null
  private readonly trackDisplayModes = new Map<Track, TrackDisplayMode>()
  private spectrogramService: SpectrogramService | null = null
  private trackPanelRequest = 0

  readonly timelineSelectionContextMenu = new ContextMenuController(
    'timeline-selection-contextmenu',
    'Selection actions',
    this.pointerStateManager,
    new ContextMenuItem('Cut', () => this.sliceSelection(true)),
    new ContextMenuItem('Copy', () => this.sliceSelection(false)),
    new ContextMenuItem('Paste', (activeTrackIndex, startSample) => this.paste(activeTrackIndex, startSample)),
    new ContextMenuItem('Freeze', () => this.freezeSelection()),
    new ContextMenuItem('Generate transcription', () => this.generateTranscription()),
    new ContextMenuSeparator(),
    new ContextMenuItem('Set selection start here', (_, sample) => this.setSelectionEdge('start', sample)),
    new ContextMenuItem('Set selection end here', (_, sample) => this.setSelectionEdge('end', sample)),
  )

  readonly timelineUnselectionContextMenu = new ContextMenuController(
    'timeline-unselection-contextmenu',
    'Timeline actions',
    this.pointerStateManager,
    new ContextMenuItem('Paste', (activeTrackIndex, startSample) => this.paste(activeTrackIndex, startSample)),
    new ContextMenuItem('Select from cursor to here', (trackIndex, sample) => {
      const waveform = this.waveforms[trackIndex]
      if (sample === AudioControl.startPosition || !waveform) {
        return
      }
      this.selectionController.setSelection(
        Math.min(sample, AudioControl.startPosition),
        Math.max(sample, AudioControl.startPosition),
        new Set([waveform]),
      )
    }),
    new ContextMenuSeparator(),
    new ContextMenuItem('Go to cursor', () => this.goToSample(this.getCursorPosition() ?? 0)),
    new ContextMenuItem('Go to time…', () => this.openGoToTime()),
  )

  private readonly timeEntryDialog = new TimeEntryDialogController()

  private readonly timelineContextMenu = new ContextMenuController(
    'timeline-contextmenu',
    'Ruler actions',
    this.pointerStateManager,
    new ContextMenuItem('Go to cursor', () => this.goToSample(this.getCursorPosition() ?? 0)),
    new ContextMenuItem('Go to time…', () => this.openGoToTime()),
  )

  private readonly cursorPoint = new DOMPoint()
  mouseEventToSvgCoord(event: MouseEvent): DOMPoint {
    this.cursorPoint.x = event.clientX - this.rootFontSize * 14
    this.cursorPoint.y = event.clientY
    return this.cursorPoint.matrixTransform(this.positionMarkerController.positionMarkerSvg.getScreenCTM()!.inverse())
  }

  mouseXToSvgCoord(x: number): number {
    this.cursorPoint.x = x - this.rootFontSize * 14
    this.cursorPoint.y = 1
    return this.cursorPoint.matrixTransform(this.positionMarkerController.positionMarkerSvg.getScreenCTM()!.inverse()).x
  }

  zoomWithWheel(wheelEvent: WheelEvent) {
    if (wheelEvent.deltaY == 0) {
      return
    }
    this.zoomBy(1.01 ** wheelEvent.deltaY, this.mouseEventToSvgCoord(wheelEvent).x)
  }

  zoomBy(scaling: number, anchorX: number) {
    if (!Number.isFinite(this.msPerUnit) || this.msPerUnit * scaling < 0.001) {
      return
    }
    this.msPerUnit *= scaling

    // t + x = (t + x - n) * s
    // t + x = st + sx - sn
    // sn = (s-1)(t+x)
    // n = (t + x)(s - 1) / s
    this.translationUnits -= ((this.translationUnits + anchorX) * (scaling - 1)) / scaling

    this.translationUnits = Math.max(this.translationUnits, 0)
    this.draw()
  }

  translate(units: number) {
    if (units == 0 || (this.translationUnits == 0 && units < 0)) {
      return
    }
    this.translationUnits += Math.round(units)
    if (this.translationUnits < 0) {
      this.translationUnits = 0
    }
    this.draw()
  }

  /** The x of the cursor when it is set and visible, else the middle of the view. */
  private viewAnchorX() {
    const cursor = this.getCursorPosition()
    if (cursor !== null) {
      const x = cursor / this.sampleScale - this.translationUnits
      if (x >= 0 && x <= this.width) {
        return x
      }
    }
    return this.width / 2
  }

  openTimeEntry(request: TimeEntryRequest): void {
    this.timeEntryDialog.open(request)
  }

  openGoToTime(): void {
    this.openTimeEntry({
      title: 'Go to time',
      submitLabel: 'Go',
      initialMs: Math.round(((this.getCursorPosition() ?? 0) * 1000) / this.sampleRate),
      onSubmit: (ms) => this.goToSample(Math.round((ms * this.sampleRate) / 1000)),
    })
  }

  constructor() {
    document.getElementById('timeline')!.addEventListener('contextmenu', (event) => {
      event.preventDefault()
      this.timelineContextMenu.draw(event.clientX, event.clientY)
    })
    document.getElementById('timeline-zoom-out-button')!.addEventListener('click', () => {
      this.zoomBy(1.25, this.viewAnchorX())
    })
    document.getElementById('timeline-zoom-in-button')!.addEventListener('click', () => {
      this.zoomBy(0.8, this.viewAnchorX())
    })
    document.getElementById('timeline-scroll-left-button')!.addEventListener('click', () => {
      this.translate(-this.width / 4)
    })
    document.getElementById('timeline-scroll-right-button')!.addEventListener('click', () => {
      this.translate(this.width / 4)
    })
    document.getElementById('timeline-go-to-time-button')!.addEventListener('click', () => this.openGoToTime())

    this.newTrackDropRegion.className = 'new-track-drop-region clickable'
    this.newTrackDropRegion.textContent = '+ new track'
    this.newTrackDropRegion.setAttribute('aria-hidden', 'true')
    this.newTrackDropRegion.hidden = true
    this.tracklistElement.appendChild(this.newTrackDropRegion)

    this.history.addChangeListener(() => {
      this.draw()
      this.trackPanelController.refreshData()
    })
    KeyPressController.addKeyDownListener((event) => this.handleKeyDown(event))

    this.resizeCallback = async () => {
      this.timelineController.resize()
      this.waveforms.forEach((w) => w.resize())
      this.automationMode?.controller.resize()
      this.positionMarkerController.resize()
      if (!Number.isFinite(this.msPerUnit)) {
        const project = await ProjectManager.getActiveProject()
        const length =
          Number.isFinite(project.getLength()) && project.getLength() > 0 ? project.getLength() : 15 * this.sampleRate
        this.msPerUnit = (length * 1.1 * 1000) / this.sampleRate / this.width
      }
      this.selectionController.resize()
      this.rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize)
      this.draw()
    }
    new ResizeObserver(this.resizeCallback).observe(document.getElementById('topdiv')!)

    AudioControl.addAudioControlListener((state) => {
      if (this.automationMode && state != AudioState.STOPPED && state != AudioState.MONITORING) {
        this.exitAutomationMode()
      }
      this.showWelcomeOnEmptyProject()
      this.trackPanelController.transcript.syncPlayback()
      switch (state) {
        case AudioState.PLAYING:
        case AudioState.RECORDING:
          this.translateToFollowPosition(0, this)
          break
        case AudioState.STOPPED:
          this.positionMarkerController.draw()
          this.selectionController.draw()
          break
      }
    })

    ProjectManager.addProjectListener((project) => {
      const focusedTrack = this.timelineKeyboard.focusedWaveform()?.track
      this.showWelcomeOnEmptyProject()
      this.sampleRate = project.sampleRate
      if (this.renderedProjectId != project.id) {
        ++this.trackPanelRequest
        this.renderedProjectId = project.id
        this.translationUnits = 0
        this.waveforms.forEach((waveform) => waveform.remove())
        this.waveforms.splice(0)
        this.infoWaveformPairs.forEach((pair) => pair.infoController.remove())
        this.infoWaveformPairs.clear()
        this.trackDisplayModes.clear()
        this.clearSelection()
        this.getSpectrogramService().setProject(project.directoryName, project.sampleRate)
      }

      const infoDivs = new Array<Node>()
      const waveformDivs = new Array<Node>()
      const nextWaveforms = new Array<Waveform>()
      const trackIds = new Set(project.getTracks().map((track) => `${track.id}`))
      if (
        this.automationMode &&
        !project.getTracks().some((track) => `${track.id}` == this.automationMode!.infoElement.dataset.trackId)
      ) {
        this.exitAutomationMode()
      }
      for (const trackId of this.infoWaveformPairs.keys()) {
        if (!trackIds.has(trackId)) {
          const pair = this.infoWaveformPairs.get(trackId)
          pair?.controller.remove()
          pair?.infoController.remove()
          if (pair !== undefined) this.trackDisplayModes.delete(pair.controller.track)
          this.infoWaveformPairs.delete(trackId)
        }
      }
      const currentTracks = new Set(project.getTracks())
      for (const track of this.trackDisplayModes.keys()) {
        if (!currentTracks.has(track)) this.trackDisplayModes.delete(track)
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
        existing?.controller.remove()
        existing?.infoController.remove()

        const trackInfoDiv = document.createElement('div')
        trackInfoDiv.dataset.trackId = `${track.id}`
        trackInfoDiv.style.height = `${7 * track.getChannelCount() + 1.5}rem`

        const waveformDiv = document.createElement('div')
        waveformDiv.addEventListener('contextmenu', (mouseEvent) => {
          mouseEvent.preventDefault()
          mouseEvent.stopPropagation()
          this.timelineUnselectionContextMenu.draw(mouseEvent.clientX, mouseEvent.clientY)
        })
        waveformDiv.style.height = `${7 * track.getChannelCount() + 1.5}rem`
        waveformDiv.id = `waveform-track-${track.id}`
        this.tracklistInfoElement.appendChild(trackInfoDiv)
        this.tracklistElement.appendChild(waveformDiv)

        const displayMode = this.trackDisplayModes.get(track) ?? 'waveform'
        const resizeTrackForAuxiliaryLanes = (heightDelta: number) => {
          const currentHeight = parseFloat(getComputedStyle(waveformDiv).height)
          const height = Math.max(0, currentHeight + heightDelta)
          trackInfoDiv.style.height = `${height}px`
          waveformDiv.style.height = `${height}px`
          trackInfoDiv.classList.toggle('has-video-lane', waveform.videoLaneHeight > 0)
        }
        const waveform = new Waveform(
          this,
          track,
          waveformDiv,
          i,
          this.getSpectrogramService(),
          displayMode,
          resizeTrackForAuxiliaryLanes,
          project.directoryName,
        )
        this.timelineKeyboard.attach(waveform)
        const trackListInfo = new TrackListInfo(project, track, trackInfoDiv, this.history, displayMode, {
          onDisplayModeChange: (mode) => {
            this.trackDisplayModes.set(track, mode)
            waveform.setDisplayMode(mode)
          },
          hasTranscript: () => getTrackTranscriptEntries(track).length > 0,
          onShowTranscript: () => {
            const entry = getTrackTranscriptEntries(track)[0]
            if (entry) this.openTrackTranscript(track, entry)
          },
          onChangeHeight: (deltaRem) => this.changeTrackHeight(trackInfoDiv, waveformDiv, waveform, deltaRem),
          onFocusChannel: () => this.timelineKeyboard.focus(waveform),
        })
        this.addTrackResizeHandles(trackInfoDiv, waveformDiv, waveform)
        nextWaveforms.push(waveform)
        this.infoWaveformPairs.set(`${track.id}`, {
          info: trackInfoDiv,
          waveform: waveformDiv,
          controller: waveform,
          infoController: trackListInfo,
        })

        infoDivs.push(trackInfoDiv)
        waveformDivs.push(waveformDiv)
      }
      this.waveforms.splice(0, this.waveforms.length, ...nextWaveforms)
      this.tracklistInfoElement.replaceChildren(...infoDivs)
      this.tracklistElement.replaceChildren(...waveformDivs, this.newTrackDropRegion)
      if (focusedTrack && document.activeElement === document.body) {
        const focusedWaveform = this.waveforms.find((waveform) => waveform.track === focusedTrack)
        if (focusedWaveform) this.timelineKeyboard.focus(focusedWaveform)
      }
      this.waveforms.forEach((waveform) => waveform.draw())
      this.selectionController.remove()
      this.pointerStateManager.reset()
      this.trackPanelController.refreshData(project)
    })
  }

  openTrackTranscript(track: Track, entry: TrackTranscriptEntry): void {
    ++this.trackPanelRequest
    this.trackPanelController.showTranscript(track, entry)
  }

  /** Opens the bottom panel's Tracks tab on `track`. */
  async revealTrack(track: Track): Promise<void> {
    const request = ++this.trackPanelRequest
    const project = await ProjectManager.getActiveProject()
    if (request !== this.trackPanelRequest || project !== (await ProjectManager.getActiveProject())) return
    this.trackPanelController.refreshData(project)
    this.trackPanelController.show(track, 'video')
  }

  private getSpectrogramService(): SpectrogramService {
    this.spectrogramService ??= new SpectrogramService()
    return this.spectrogramService
  }

  private changeTrackHeight(
    trackInfoDiv: HTMLDivElement,
    waveformDiv: HTMLDivElement,
    waveform: Waveform,
    deltaRem: number,
  ) {
    const height = Math.max(
      6 * this.rootFontSize + waveform.auxiliaryLaneHeight,
      waveformDiv.getBoundingClientRect().height + deltaRem * this.rootFontSize,
    )
    trackInfoDiv.style.height = `${height}px`
    waveformDiv.style.height = `${height}px`
  }

  private addTrackResizeHandles(trackInfoDiv: HTMLDivElement, waveformDiv: HTMLDivElement, waveform: Waveform) {
    const startResize = (event: PointerEvent) => {
      if (event.button != 0) {
        return
      }
      event.preventDefault()
      event.stopPropagation()

      const handle = event.currentTarget as HTMLDivElement
      const pointerId = event.pointerId
      const startY = event.clientY
      const startHeight = waveformDiv.getBoundingClientRect().height
      const minimumHeight = 6 * this.rootFontSize + waveform.auxiliaryLaneHeight

      handle.setPointerCapture(pointerId)
      handle.classList.add('track-resize-handle-active')

      const resize = (moveEvent: PointerEvent) => {
        const height = Math.max(minimumHeight, startHeight + moveEvent.clientY - startY)
        trackInfoDiv.style.height = `${height}px`
        waveformDiv.style.height = `${height}px`
      }
      const stopResize = () => {
        handle.classList.remove('track-resize-handle-active')
        handle.removeEventListener('pointermove', resize)
        handle.removeEventListener('pointerup', stopResize)
        handle.removeEventListener('pointercancel', stopResize)
        handle.removeEventListener('lostpointercapture', stopResize)
      }

      handle.addEventListener('pointermove', resize)
      handle.addEventListener('pointerup', stopResize)
      handle.addEventListener('pointercancel', stopResize)
      handle.addEventListener('lostpointercapture', stopResize)
    }

    for (const parent of [trackInfoDiv, waveformDiv]) {
      const handle = document.createElement('div')
      handle.className = 'track-resize-handle'
      handle.title = 'Change track height'
      handle.setAttribute('aria-hidden', 'true')
      handle.addEventListener('pointerdown', startResize)
      handle.addEventListener('click', (event) => event.stopPropagation())
      handle.addEventListener('dblclick', (event) => event.stopPropagation())
      parent.appendChild(handle)
    }
  }

  showNewTrackDropRegion(channelCount: number) {
    this.newTrackDropRegion.style.height = `${7 * channelCount + 1.5}rem`
    this.newTrackDropRegion.hidden = false
  }

  hideNewTrackDropRegion() {
    this.newTrackDropRegion.hidden = true
  }

  isPointInNewTrackDropRegion(clientX: number, clientY: number) {
    if (this.newTrackDropRegion.hidden) {
      return false
    }
    const bounds = this.newTrackDropRegion.getBoundingClientRect()
    return clientX >= bounds.left && clientX <= bounds.right && clientY >= bounds.top && clientY <= bounds.bottom
  }

  selectTrack(waveform: Waveform) {
    if (this.automationMode) {
      return
    }
    this.selectionController.setSelection(0, waveform.track.length, new Set([waveform]))
  }

  selectClipView(clipView: ClipView, waveform: Waveform) {
    if (this.automationMode) {
      return
    }
    this.selectionController.setSelection(clipView.startPosition, clipView.getEndPosition(), new Set([waveform]))
  }

  private setSelectionEdge(edge: 'start' | 'end', sample: number) {
    const region = this.selectedRegion
    if (!region) {
      return
    }
    const start = edge == 'start' ? sample : region.startSample
    const end = edge == 'end' ? sample : region.endSample
    if (start >= end) {
      NotificationsController.showShortDurationMessage('The selection start must be before its end.')
      return
    }
    this.selectionController.updateRange(start, end)
  }

  clearSelection() {
    this.selectionController.remove()
  }

  enterAutomationMode(track: Track, effectInstanceId: string, parameters: ParameterMetadata[]) {
    this.exitAutomationMode()
    const pair = this.infoWaveformPairs.get(`${track.id}`)
    const parameterMetadata = parameters[0]
    if (!pair || !parameterMetadata) {
      return
    }

    this.clearSelection()
    this.pointerStateManager.startAutomating()

    for (const [trackId, candidate] of this.infoWaveformPairs) {
      const isActive = trackId == `${track.id}`
      candidate.info.inert = !isActive
      candidate.waveform.inert = !isActive
      candidate.info.classList.toggle('automation-dimmed', !isActive)
      candidate.waveform.classList.toggle('automation-dimmed', !isActive)
      candidate.waveform.classList.toggle('automation-active-waveform', isActive)
      candidate.controller.setMediaOverlayVisible(false)
    }

    const originalInfoElements = Array.from(pair.info.childNodes)
    const selectParameter = (selectedParameter: ParameterMetadata) => {
      const mode = this.automationMode
      if (!mode) {
        return
      }
      mode.controller.remove()
      mode.controller = new AutomationController(
        this,
        effectInstanceId,
        pair.controller.topSvgElement,
        track,
        selectedParameter,
        pair.controller.audioLaneTop,
      )
      mode.controller.draw()
    }
    const modeInfoElement = this.createAutomationModeInfo(track, parameters, parameterMetadata, selectParameter)
    pair.info.replaceChildren(modeInfoElement)
    const infoResizeHandle = originalInfoElements.find(
      (element) => element instanceof HTMLElement && element.classList.contains('track-resize-handle'),
    )
    if (infoResizeHandle) {
      pair.info.appendChild(infoResizeHandle)
    }

    const controller = new AutomationController(
      this,
      effectInstanceId,
      pair.controller.topSvgElement,
      track,
      parameterMetadata,
      pair.controller.audioLaneTop,
    )
    this.automationMode = { controller, infoElement: pair.info, originalInfoElements }
    controller.draw()
    pair.info.querySelector<HTMLSelectElement>('.automation-parameter-select')?.focus()
    announce(`${parameterMetadata.displayName} automation for ${track.name}`)
  }

  exitAutomationMode() {
    const mode = this.automationMode
    if (!mode) {
      return
    }
    const hadFocus = mode.infoElement.contains(document.activeElement)
    mode.controller.remove()
    mode.infoElement.replaceChildren(...mode.originalInfoElements)
    for (const pair of this.infoWaveformPairs.values()) {
      pair.info.classList.remove('automation-dimmed')
      pair.info.inert = false
      pair.waveform.inert = false
      pair.waveform.classList.remove('automation-dimmed', 'automation-active-waveform')
      pair.controller.setMediaOverlayVisible(true)
    }
    if (hadFocus) mode.infoElement.querySelector<HTMLElement>('.track-effect-selector')?.focus()
    this.automationMode = null
    this.pointerStateManager.stopAutomating()
  }

  private createAutomationModeInfo(
    track: Track,
    parameters: ParameterMetadata[],
    parameterMetadata: ParameterMetadata,
    selectParameter: (parameter: ParameterMetadata) => void,
  ) {
    const panel = document.createElement('section')
    panel.className = 'automation-track-info'

    const heading = document.createElement('div')
    heading.className = 'automation-track-heading'
    const modeLabel = document.createElement('strong')
    modeLabel.textContent = 'Automation'
    const trackRow = document.createElement('span')
    trackRow.className = 'automation-context-row'
    const trackLabel = document.createElement('small')
    trackLabel.textContent = 'Track'
    const trackName = document.createElement('span')
    trackName.textContent = track.name
    trackRow.append(trackLabel, trackName)
    const parameterRow = document.createElement('span')
    parameterRow.className = 'automation-context-row'
    const parameterLabel = document.createElement('small')
    parameterLabel.textContent = 'Parameter'
    const parameterSelect = document.createElement('select')
    parameterSelect.className = 'automation-parameter-select'
    parameterSelect.setAttribute('aria-label', 'Automation parameter')
    for (const parameter of parameters) {
      const option = document.createElement('option')
      option.value = parameter.id
      option.textContent = parameter.displayName
      parameterSelect.appendChild(option)
    }
    parameterSelect.value = parameterMetadata.id
    parameterSelect.addEventListener('change', () => {
      const selectedParameter = parameters.find((parameter) => parameter.id == parameterSelect.value)
      if (selectedParameter) {
        selectParameter(selectedParameter)
      }
    })
    parameterRow.append(parameterLabel, parameterSelect)
    heading.append(modeLabel, trackRow, parameterRow)

    const exitButton = document.createElement('button')
    exitButton.type = 'button'
    exitButton.className = 'clickable automation-exit-button'
    exitButton.textContent = 'Back'
    exitButton.addEventListener('click', () => this.exitAutomationMode())
    panel.append(heading, exitButton)
    return panel
  }

  async transferClipViewToNewTrack(oldTrack: Track, oldClipView: ClipView, shift = 0) {
    const project = await ProjectManager.getActiveProject()
    const clipView = cloneClipViewWithNewStartPosition(oldClipView, shift)
    const trackNames = new Set(project.getTracks().map((track) => track.name))
    let trackNumber = project.getTracks().length + 1
    while (trackNames.has(`Track ${trackNumber}`)) {
      ++trackNumber
    }
    const newTrack = new Track(`Track ${trackNumber}`, clipView.clip.getChannelCount())
    await this.history.execute(
      new MoveClipViewToNewTrackCommand(project, oldTrack, newTrack, oldClipView, clipView, project.getTracks().length),
    )
    announce(`Moved clip to ${newTrack.name}`)
  }

  async transferClipViewBetweenTracks(clipViewController: ClipViewController, oldWaveform: Waveform) {
    const newWaveform = clipViewController.waveform
    const newTrack = newWaveform.track
    const oldClipView = clipViewController.clipView
    const clipView = cloneClipViewWithNewStartPosition(oldClipView, clipViewController.draggedShift)
    if (!newTrack.canAddClipView(clipView)) {
      clipViewController.draggedShift = 0
      clipViewController.switchParent(oldWaveform)
      oldWaveform.drawAudioData()
      return
    }
    await this.history.execute(new MoveClipViewBetweenTracksCommand(oldWaveform.track, newTrack, oldClipView, clipView))
    newWaveform.removeClipViewController(clipViewController)
  }

  async sliceSelection(del: boolean) {
    const newClipboard: typeof Clipboard.copiedClipViews = []
    const undoCommands: SetTrackClipViewsCommand[] = []
    const selection = this.selectionController.selectedRegion
    if (!selection) {
      return
    }
    selection?.tracks.forEach((track) => {
      const oldClipViews = track.clipViews.slice()
      newClipboard.push(track.slice(selection.startSample, selection.endSample, del))
      if (del && !this.clipViewArraysEqual(oldClipViews, track.clipViews)) {
        undoCommands.push(new SetTrackClipViewsCommand(track, oldClipViews, track.clipViews.slice()))
      }
    })
    Clipboard.copiedClipViews = newClipboard
    Clipboard.copyStartPosition = selection.startSample
    announce(
      `${del ? 'Cut' : 'Copied'} ${TimeUtils.toSpokenString(((selection.endSample - selection.startSample) * 1000) / this.sampleRate)}`,
    )
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
          NotificationsController.showShortDurationMessage('Cannot paste here: the clips would overlap existing clips.')
          return
        }
        undoCommands.push(new AddClipViewCommand(newClipView, track))
      }
    }
    if (undoCommands.length > 0) {
      await this.history.execute(new BatchCommand(undoCommands, 'paste'))
      const n = undoCommands.length
      announce(`Pasted ${n} ${n == 1 ? 'clip' : 'clips'}`)
    }
  }

  private async freezeSelection() {
    if (!this.canEdit()) {
      return
    }
    const selection = this.selectedRegion
    if (!selection) {
      return
    }

    // Rendering is loaded only after freeze starts, keeping it out of the initial timeline chunk.
    const { Freezer } = await import('../../freezer/Freezer')

    ;(window as any).processingModalController?.show('Freezing selection...', () => Freezer.cancelFreeze())
    try {
      await Freezer.freezeSelection(selection)
      this.clearSelection()
    } catch (error) {
      NotificationsController.showError(error as Error)
    } finally {
      ;(window as any).processingModalController?.hide()
    }
  }

  private async generateTranscription() {
    if (!this.canEdit()) {
      return
    }
    const selection = this.selectedRegion
    if (!selection) {
      return
    }
    await this.transcribe(selection, 'the selected region')
  }

  /** Transcribes all of `track`'s audio, as Generate transcription does for a selection. */
  async transcribeTrack(track: Track): Promise<void> {
    if (!this.canEdit()) {
      NotificationsController.showLongDurationMessage('Stop playback or recording before transcribing.')
      return
    }
    await this.transcribe({ startSample: 0, endSample: track.length, tracks: [track] }, track.name)
  }

  /** `where` names the region in messages, such as "the selected region" or a track name. */
  private async transcribe(region: SelectedRegion, where: string) {
    const intervals = getSelectedClipIntervals(region)
    if (intervals.length === 0) {
      NotificationsController.showLongDurationMessage(`There is no audio to transcribe in ${where}.`)
      return
    }

    const modal = (window as TrackListWindow).processingModalController
    let displayedTitle = 'Preparing Granite transcription…'
    modal?.show(displayedTitle, () => Transcriber.cancel())
    try {
      const project = await ProjectManager.getActiveProject()
      const results = await Transcriber.transcribe(project, intervals, (progress) => {
        let title: string
        switch (progress.stage) {
          case 'download':
            title = 'Downloading Granite speech model…'
            break
          case 'loading':
            title = `Loading Granite speech model (${progress.backend ?? 'WebGPU/WASM'})…`
            break
          case 'segmenting':
            title = 'Finding speech segments (VAD)…'
            break
          case 'transcribing':
            title = `Generating transcription (${progress.backend ?? 'WebGPU/WASM'})…`
            break
        }
        if (title !== displayedTitle) {
          displayedTitle = title
          modal?.setTitle(title)
        }
        modal?.setProgress(progress.progress)
      })

      const replacementsByClip = new Map<Clip, TranscriptionReplacement[]>()
      let generatedWordCount = 0
      let untranscribedCount = 0
      for (const result of results) {
        const replacements = replacementsByClip.get(result.clip) ?? []
        replacements.push({
          startSample: result.startSample,
          endSample: result.endSample,
          ranges: result.ranges,
        })
        replacementsByClip.set(result.clip, replacements)
        for (const range of result.ranges) {
          if (range.kind === undefined) ++generatedWordCount
          else if (range.kind === 'untranscribed') ++untranscribedCount
        }
      }

      const commands = new Array<SetClipTranscriptionCommand>()
      for (const [clip, replacements] of replacementsByClip) {
        const replacement = replaceTranscriptionRanges(clip.transcription, replacements)
        if (!transcriptionRangesEqual(clip.transcription, replacement)) {
          commands.push(new SetClipTranscriptionCommand(clip, clip.transcription, replacement))
        }
      }
      if (commands.length > 0) {
        await this.history.execute(new BatchCommand(commands, 'generate transcription'))
      }
      if (generatedWordCount === 0) {
        NotificationsController.showLongDurationMessage(
          untranscribedCount > 0
            ? `Speech was detected in ${where}, but no words were recognized.`
            : `No speech was detected in ${where}.`,
        )
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        NotificationsController.showError(error instanceof Error ? error : new Error(String(error)))
      }
    } finally {
      modal?.hide()
    }
  }

  draw() {
    this.timelineController.draw()
    this.waveforms.forEach((waveform) => waveform.draw())
    this.automationMode?.controller.draw()
    this.selectionController.draw()
    this.positionMarkerController.draw()
    this.trackPanelController.transcript.syncPlayback()
    this.timelineKeyboard.refresh()
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
      if (!this.selectionController.selectedRegion || document.getSelection()?.isCollapsed === false) {
        return
      }
      event.preventDefault()
      this.sliceSelection(false)
      return
    }
    if (!event.shiftKey && event.code == 'KeyX') {
      if (
        !this.selectionController.selectedRegion ||
        document.getSelection()?.isCollapsed === false ||
        !this.canEdit()
      ) {
        return
      }
      event.preventDefault()
      void this.sliceSelection(true)
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
        this.timelineKeyboard.focusedWaveform()?.index ??
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
        void this.redo()
      } else {
        void this.undo()
      }
      return
    }
    if (event.ctrlKey && event.code == 'KeyY') {
      event.preventDefault()
      if (!this.canEdit()) {
        return
      }
      void this.redo()
    }
  }

  private async undo() {
    const action = this.history.undoActionString
    await this.history.undo()
    if (action) announce(`Undid ${action}`)
  }

  private async redo() {
    const action = this.history.redoActionString
    await this.history.redo()
    if (action) announce(`Redid ${action}`)
  }

  private async showWelcomeOnEmptyProject() {
    const project = await ProjectManager.getActiveProject()
    if (
      project.getTracks().length == 0 &&
      project.getClips().length == 0 &&
      AudioControl.getState() == AudioState.STOPPED
    ) {
      document.getElementById('timeline-body')!.hidden = true
      document.getElementById('welcome')!.hidden = false
    } else {
      document.getElementById('timeline-body')!.hidden = false
      document.getElementById('welcome')!.hidden = true
      this.resizeCallback()
    }
  }

  canEdit() {
    return (
      !this.automationMode &&
      (AudioControl.getState() == AudioState.STOPPED ||
        AudioControl.getState() == AudioState.MONITORING ||
        AudioControl.getState() == AudioState.MONITORING_PAUSED)
    )
  }

  private shouldIgnoreKeyboardShortcut(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) {
      return false
    }
    if (target.isContentEditable || target.tagName == 'TEXTAREA') {
      return true
    }
    if (target instanceof HTMLSelectElement || target.closest('dialog[open]')) {
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

  /** Centers the timeline view on this sample position. */
  goToSample(sample: number) {
    if (!Number.isFinite(this.msPerUnit)) {
      return
    }
    this.translationUnits = Math.max(0, Math.round(sample / this.sampleScale - this.width / 2))
    this.draw()
  }

  /**
   * The sample position of the cursor (the position marker), or null when no
   * cursor is set.
   */
  private getCursorPosition(): number | null {
    const state = AudioControl.getState()
    if (state == AudioState.STOPPED || state == AudioState.MONITORING || state == AudioState.MONITORING_PAUSED) {
      return AudioControl.startPosition == 0 ? null : AudioControl.startPosition
    }
    return AudioControl.audioContext?.getPosition() ?? AudioControl.startPosition
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
    this.trackPanelController.transcript.syncPlayback(position)
  }
}
