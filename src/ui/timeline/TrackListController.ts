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
import { GoToTimeController } from './GoToTimeController'
import type { Clip } from '../../project/Clip'
import { Transcriber } from '../../transcription/Transcriber'
import {
  getSelectedClipIntervals,
  replaceTranscriptionRanges,
  transcriptionRangesEqual,
} from '../../transcription/TranscriptionSelection'
import type { TranscriptionReplacement } from '../../transcription/TranscriptionSelection'
import type { ProcessingModalController } from '../ProcessingModalController'

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

  readonly timelineSelectionContextMenu = new ContextMenuController(
    'timeline-selection-contextmenu',
    this.pointerStateManager,
    new ContextMenuItem('Cut', () => this.sliceSelection(true)),
    new ContextMenuItem('Copy', () => this.sliceSelection(false)),
    new ContextMenuItem('Paste', (activeTrackIndex, startSample) => this.paste(activeTrackIndex, startSample)),
    new ContextMenuItem('Freeze', () => this.freezeSelection()),
    new ContextMenuItem('Generate transcription', () => this.generateTranscription()),
  )

  private readonly timelineUnselectionContextMenu = new ContextMenuController(
    'timeline-unselection-contextmenu',
    this.pointerStateManager,
    new ContextMenuItem('Paste', (activeTrackIndex, startSample) => this.paste(activeTrackIndex, startSample)),
  )

  private readonly goToTimeController = new GoToTimeController((ms) =>
    this.goToSample(Math.round((ms * this.sampleRate) / 1000)),
  )

  private readonly timelineContextMenu = new ContextMenuController(
    'timeline-contextmenu',
    this.pointerStateManager,
    new ContextMenuItem('Go to cursor', () => this.goToSample(this.getCursorPosition() ?? 0)),
    new ContextMenuItem('Go to time', () => this.goToTimeController.open()),
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
    document.getElementById('timeline')!.addEventListener('contextmenu', (event) => {
      event.preventDefault()
      this.timelineContextMenu.draw(event.clientX, event.clientY)
    })

    this.newTrackDropRegion.className = 'new-track-drop-region clickable'
    this.newTrackDropRegion.textContent = '+ new track'
    this.newTrackDropRegion.setAttribute('aria-label', 'Drop clip to create a new track')
    this.newTrackDropRegion.hidden = true
    this.tracklistElement.appendChild(this.newTrackDropRegion)

    this.history.addChangeListener(() => this.draw())
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
      this.showWelcomeOnEmptyProject()
      this.sampleRate = project.sampleRate
      if (this.renderedProjectId != project.id) {
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
          this.timelineUnselectionContextMenu.draw(mouseEvent.clientX, mouseEvent.clientY)
        })
        waveformDiv.style.height = `${7 * track.getChannelCount() + 1.5}rem`
        waveformDiv.id = `waveform-track-${track.id}`
        this.tracklistInfoElement.appendChild(trackInfoDiv)
        this.tracklistElement.appendChild(waveformDiv)

        const displayMode = this.trackDisplayModes.get(track) ?? 'waveform'
        const waveform = new Waveform(this, track, waveformDiv, i, this.getSpectrogramService(), displayMode)
        const trackListInfo = new TrackListInfo(project, track, trackInfoDiv, this.history, displayMode, (mode) => {
          this.trackDisplayModes.set(track, mode)
          waveform.setDisplayMode(mode)
        })
        this.addTrackResizeHandles(trackInfoDiv, waveformDiv)
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
      this.waveforms.forEach((waveform) => waveform.draw())
      this.selectionController.remove()
      this.pointerStateManager
    })
  }

  private getSpectrogramService(): SpectrogramService {
    this.spectrogramService ??= new SpectrogramService()
    return this.spectrogramService
  }

  private addTrackResizeHandles(trackInfoDiv: HTMLDivElement, waveformDiv: HTMLDivElement) {
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
      const minimumHeight = 6 * this.rootFontSize

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
      candidate.info.classList.toggle('automation-dimmed', !isActive)
      candidate.waveform.classList.toggle('automation-dimmed', !isActive)
      candidate.waveform.classList.toggle('automation-active-waveform', isActive)
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
        Waveform.HEADER_HEIGHT,
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
      Waveform.HEADER_HEIGHT,
    )
    this.automationMode = { controller, infoElement: pair.info, originalInfoElements }
    controller.draw()
  }

  exitAutomationMode() {
    const mode = this.automationMode
    if (!mode) {
      return
    }
    mode.controller.remove()
    mode.infoElement.replaceChildren(...mode.originalInfoElements)
    for (const pair of this.infoWaveformPairs.values()) {
      pair.info.classList.remove('automation-dimmed')
      pair.waveform.classList.remove('automation-dimmed', 'automation-active-waveform')
    }
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

  async transferClipViewToNewTrack(clipViewController: ClipViewController) {
    const project = await ProjectManager.getActiveProject()
    const oldWaveform = clipViewController.waveform
    const oldClipView = oldWaveform.track.clipViews[clipViewController.clipViewIndex]
    const clipView = cloneClipViewWithNewStartPosition(oldClipView, clipViewController.draggedShift)
    const trackNames = new Set(project.getTracks().map((track) => track.name))
    let trackNumber = project.getTracks().length + 1
    while (trackNames.has(`Track ${trackNumber}`)) {
      ++trackNumber
    }
    const newTrack = new Track(`Track ${trackNumber}`, clipView.clip.getChannelCount())
    await this.history.execute(
      new MoveClipViewToNewTrackCommand(
        project,
        oldWaveform.track,
        newTrack,
        oldClipView,
        clipView,
        project.getTracks().length,
      ),
    )
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
    const intervals = getSelectedClipIntervals(selection)
    if (intervals.length === 0) {
      NotificationsController.showLongDurationMessage('The selected region contains no audio to transcribe.')
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
      for (const result of results) {
        const replacements = replacementsByClip.get(result.clip) ?? []
        replacements.push({
          startSample: result.startSample,
          endSample: result.endSample,
          ranges: result.ranges,
        })
        replacementsByClip.set(result.clip, replacements)
        generatedWordCount += result.ranges.length
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
      } else if (generatedWordCount === 0) {
        NotificationsController.showLongDurationMessage('No speech was detected in the selected audio.')
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

  private async showWelcomeOnEmptyProject() {
    const project = await ProjectManager.getActiveProject()
    if (
      project.getTracks().length == 0 &&
      project.getClips().length == 0 &&
      AudioControl.getState() == AudioState.STOPPED
    ) {
      document.getElementById('timeline-body')!.style.display = 'none'
      document.getElementById('welcome')!.style.display = ''
    } else {
      document.getElementById('timeline-body')!.style.display = ''
      document.getElementById('welcome')!.style.display = 'none'
      this.resizeCallback()
    }
  }

  private canEdit() {
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
  }
}
