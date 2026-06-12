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
import { Player, SelectedRegion } from '../../playback/Player'
import { editorHistory } from '../undo/EditorHistory'
import { EffectPanelController } from '../effects/EffectPanelController'
import { Effect, EffectType, createEffectId, replaceEffectRegion } from '../../effects/Effects'
import { TimeUtils } from '../../global/TimeUtils'
import {
  AddClipViewCommand,
  BatchCommand,
  MoveClipViewBetweenTracksCommand,
  SetTrackEffectRegionsCommand,
  SetTrackClipViewsCommand,
} from '../undo/UndoableActions'
import { Track } from '../../project/Track'

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
    return this.timelineController.getWidth()
  }

  get height() {
    return this.timelineController.getHeight() + this.tracklistElement.clientHeight
  }

  get selectedRegion(): SelectedRegion | null {
    if (!this.selection) {
      return null
    }
    return {
      startSample: Math.min(this.selection.startSample, this.selection.endSample),
      endSample: Math.max(this.selection.startSample, this.selection.endSample),
      tracks: [...this.selection.waveforms.values().map((w) => w.track)],
    }
  }

  private waveforms = new Array<Waveform>()
  readonly timelineController = new TimelineController(this)
  readonly inputListController = new InputListController()
  readonly positionMarkerController = new PositionMarkerController(this)
  readonly history = editorHistory
  readonly pointerStateManager = new PointerStateManager(this)
  private readonly effectPanelController = new EffectPanelController()

  private selection: Selection | null = null
  private draggedFirstWaveform: Waveform | null = null
  private readonly activeTrackEffects = new Map<number, EffectType | null>()
  private readonly tracklistElement = document.getElementById('track-list')!
  private readonly tracklistInfoElement = document.getElementById('track-info-list')!
  private readonly infoWaveformPairs = new Map<
    string,
    { info: HTMLElement; waveform: HTMLElement; controller: Waveform }
  >()
  private renderedProjectId: number | undefined = undefined
  private openEffectPanelState: { track: Track; effectRegionId: string } | null = null
  private effectEditStart: { track: Track; effectRegions: Effect[] } | null = null
  private openEffectPanelInput: HTMLInputElement | null = null
  private openEffectPanelOutput: HTMLOutputElement | null = null

  readonly timelineSelectionContextMenu = new ContextMenuController(
    'timeline-selection-contextmenu',
    this.pointerStateManager,
    new ContextMenuItem('Cut', () => this.sliceSelection(true)),
    new ContextMenuItem('Copy', () => this.sliceSelection(false)),
    new ContextMenuItem('Paste', (activeTrackIndex, startSample) => this.paste(activeTrackIndex, startSample)),
    new ContextMenuItem('Effect...', () => this.createGainEffectsFromSelection(false)),
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
        this.waveforms = []
        this.infoWaveformPairs.clear()
        this.activeTrackEffects.clear()
        this.clearSelection()
        this.effectPanelController.close()
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
        const trackListInfo = new TrackListInfo(track, trackInfoDiv, this.history, (changedTrack, effect) =>
          this.setActiveTrackEffect(changedTrack, effect),
        )

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

        new ResizeObserver(async (_) => {
          waveform.resize()
          waveform.draw()
        }).observe(waveformDiv)

        infoDivs.push(trackInfoDiv)
        waveformDivs.push(waveformDiv)
      }
      this.waveforms = nextWaveforms
      this.tracklistInfoElement.replaceChildren(...infoDivs)
      this.tracklistElement.replaceChildren(...waveformDivs)
      this.waveforms.forEach((waveform) => waveform.draw())
    })
  }

  selectTrack(waveform: Waveform) {
    this.selection = {
      startSample: 0,
      endSample: waveform.track.length,
      waveforms: new Set<Waveform>(),
    }
    this.pointerStateManager.startSelecting()
    this.selection.waveforms.add(waveform)
    this.drawSelection()
  }

  setSelection(startSample: number, endSample: number, waveforms: Set<Waveform>) {
    this.selection = {
      startSample: startSample,
      endSample: endSample,
      waveforms: waveforms,
    }
    this.pointerStateManager.startSelecting()
    this.drawSelection()
  }

  updateSelectionStartSample(leftExpand: boolean) {
    if (
      (leftExpand && this.selection!.startSample < this.selection!.endSample) ||
      (!leftExpand && this.selection!.startSample > this.selection!.endSample)
    ) {
      const startSample = this.selection!.startSample
      this.selection!.startSample = this.selection!.endSample
      this.selection!.endSample = startSample
    }
  }

  updateSelection(xCoord: number, waveform: Waveform | null, dragged: boolean) {
    xCoord = Math.max(xCoord, 0)
    if (!dragged || !waveform) {
      this.selection = {
        startSample: this.selection?.startSample ?? xCoord,
        endSample: xCoord,
        waveforms: this.selection?.waveforms ?? new Set<Waveform>(),
      }
      if (waveform) {
        this.selection.waveforms.add(waveform)
      }
      this.drawSelection()
      return
    }
    if (!this.draggedFirstWaveform) {
      this.draggedFirstWaveform = waveform
    }
    this.selection = {
      startSample: this.selection?.startSample ?? xCoord,
      endSample: xCoord,
      waveforms: this.selection?.waveforms ?? new Set<Waveform>(),
    }
    let firstWaveform: Waveform | null = null
    for (const w of this.waveforms) {
      if (!firstWaveform && (w == this.draggedFirstWaveform || w == waveform)) {
        firstWaveform = w
      }
      if (firstWaveform) {
        this.selection!.waveforms.add(w)
      } else if (!KeyPressController.metaPressed) {
        this.selection!.waveforms.delete(w)
      }
      if (
        (w != firstWaveform && (w == this.draggedFirstWaveform || w == waveform)) ||
        this.draggedFirstWaveform == waveform
      ) {
        firstWaveform = null
      }
    }
    this.drawSelection()
  }

  clearSelection() {
    this.selection = null
    this.draggedFirstWaveform = null
    this.timelineController.removeSelection()
    this.waveforms.forEach((w) => w.drawSelection(-1, -1))
  }

  getDisplayedEffectForTrack(track: Track): EffectType | null {
    return this.activeTrackEffects.get(track.id ?? -1) ?? null
  }

  async finishSelectionDrag() {
    await this.createGainEffectsFromSelection(true)
  }

  openEffectRegion(track: Track, effectRegionId: string) {
    const effectRegion = track.getEffectRegionById(effectRegionId)
    if (!effectRegion) {
      return
    }
    this.openEffectPanelState = { track, effectRegionId }
    this.effectEditStart = null
    switch (effectRegion.effect) {
      case 'gain':
        this.openGainEffectPanel(track, effectRegion)
        break
    }
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
    if (!this.selection) {
      return
    }
    const newClipboard: typeof Clipboard.copiedClipViews = []
    const undoCommands: SetTrackClipViewsCommand[] = []
    const lowSample = Math.min(this.selection!.startSample, this.selection!.endSample)
    const highSample = Math.max(this.selection!.startSample, this.selection!.endSample)
    this.selection.waveforms.forEach((waveform) => {
      const oldClipViews = waveform.track.clipViews.slice()
      newClipboard.push(waveform.track.slice(lowSample, highSample, del))
      if (del && !this.clipViewArraysEqual(oldClipViews, waveform.track.clipViews)) {
        undoCommands.push(new SetTrackClipViewsCommand(waveform.track, oldClipViews, waveform.track.clipViews.slice()))
      } else {
        waveform.drawAudioData()
      }
    })
    Clipboard.copiedClipViews = newClipboard
    Clipboard.copyStartPosition = lowSample
    if (del && undoCommands.length > 0) {
      await this.history.recordApplied(new BatchCommand(undoCommands, del ? 'cut' : 'copy'))
    }
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

  private drawSelection() {
    if (!this.selection || this.selection.startSample == this.selection.endSample) {
      return
    }
    const startSample = Math.min(this.selection!.startSample, this.selection!.endSample)
    const endSample = Math.max(this.selection!.startSample, this.selection!.endSample)
    this.timelineController.drawSelection(startSample, endSample)
    this.waveforms.forEach((w) =>
      this.selection?.waveforms.has(w) ? w.drawSelection(startSample, endSample) : w.drawSelection(-1, -1),
    )
  }

  draw() {
    this.timelineController.draw()
    this.waveforms.forEach((waveform) => waveform.draw())
    this.drawSelection()
    this.positionMarkerController.draw()
    this.refreshOpenEffectPanel()
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
      if (!this.selection) {
        return
      }
      event.preventDefault()
      void this.sliceSelection(false)
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
        this.waveforms.find((waveform) => this.selection?.waveforms.has(waveform))?.index ??
        0
      void this.paste(trackIndex, AudioControl.startPosition)
      return
    }
    if (event.code == 'KeyZ') {
      event.preventDefault()
      if (!this.canEdit()) {
        return
      }
      if (event.shiftKey) {
        void this.history.redo()
      } else {
        void this.history.undo()
      }
      return
    }
    if (event.ctrlKey && event.code == 'KeyY') {
      event.preventDefault()
      if (!this.canEdit()) {
        return
      }
      void this.history.redo()
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

  private setActiveTrackEffect(track: Track, effect: EffectType | null) {
    this.activeTrackEffects.set(track.id ?? -1, effect)
    if (!effect && this.openEffectPanelState?.track == track) {
      this.effectPanelController.close()
    }
    this.draw()
  }

  private async createGainEffectsFromSelection(onlyForActiveTrackEffects: boolean) {
    if (!this.selection || this.selection.startSample == this.selection.endSample || !this.canEdit()) {
      return
    }
    const startSample = Math.min(this.selection.startSample, this.selection.endSample)
    const endSample = Math.max(this.selection.startSample, this.selection.endSample)
    const undoCommands: SetTrackEffectRegionsCommand[] = []
    const createdRegions = new Array<{ track: Track; effectRegionId: string }>()

    for (const waveform of this.selection.waveforms) {
      const effect = this.getDisplayedEffectForTrack(waveform.track)
      if (onlyForActiveTrackEffects && effect != 'gain') {
        continue
      }
      const effectRegion: Effect = {
        id: createEffectId(),
        effect: 'gain',
        startSample,
        length: endSample - startSample,
        value: 0,
      }
      const oldEffectRegions = this.cloneEffectRegions(waveform.track.getEffectRegions())
      const newEffectRegions = replaceEffectRegion(oldEffectRegions, effectRegion)
      undoCommands.push(new SetTrackEffectRegionsCommand(waveform.track, oldEffectRegions, newEffectRegions))
      createdRegions.push({ track: waveform.track, effectRegionId: effectRegion.id })
    }

    if (undoCommands.length == 0) {
      return
    }

    if (undoCommands.length == 1) {
      await this.history.execute(undoCommands[0])
    } else {
      await this.history.execute(new BatchCommand(undoCommands, 'change gain'))
    }
    const firstCreatedRegion = createdRegions[0]
    if (firstCreatedRegion) {
      this.openEffectRegion(firstCreatedRegion.track, firstCreatedRegion.effectRegionId)
    }
  }

  private startEffectRegionEdit(track: Track) {
    if (this.effectEditStart?.track == track) {
      return
    }
    this.effectEditStart = {
      track,
      effectRegions: this.cloneEffectRegions(track.getEffectRegions()),
    }
  }

  private updateGainEffectRegion(track: Track, effectRegionId: string, value: number) {
    const effectRegion = track.getEffectRegionById(effectRegionId)
    if (!effectRegion || effectRegion.effect != 'gain') {
      return
    }
    track.setEffectRegions(
      replaceEffectRegion(track.getEffectRegions(), {
        ...effectRegion,
        value,
      }),
    )
    this.draw()
  }

  private openGainEffectPanel(track: Track, effectRegion: Effect) {
    const valueLabelElement = document.createElement('label')
    valueLabelElement.textContent = 'Gain'
    valueLabelElement.htmlFor = 'effect-panel-gain-value'

    const valueSlider = document.createElement('input')
    valueSlider.id = 'effect-panel-gain-value'
    valueSlider.type = 'range'
    valueSlider.min = '-36'
    valueSlider.max = '36'
    valueSlider.step = '0.1'
    valueSlider.value = `${effectRegion.value}`

    const valueOutput = document.createElement('output')
    valueOutput.className = 'slider-value effect-panel-value-output'
    valueOutput.style.opacity = '1'
    this.updateGainEffectOutput(valueOutput, effectRegion.value)

    valueSlider.addEventListener('pointerdown', () => this.startEffectRegionEdit(track))
    valueSlider.addEventListener('focus', () => this.startEffectRegionEdit(track))
    valueSlider.addEventListener('input', () => {
      const value = Number(valueSlider.value)
      this.updateGainEffectOutput(valueOutput, value)
      this.updateGainEffectRegion(track, effectRegion.id, value)
    })
    valueSlider.addEventListener('change', () => void this.commitEffectRegionEdit(track))

    const valueGroup = document.createElement('div')
    valueGroup.className = 'effect-panel-control-group'
    valueGroup.append(valueLabelElement, valueSlider, valueOutput)

    const deleteButton = document.createElement('button')
    deleteButton.className = 'menu-item clickable effect-panel-delete'
    deleteButton.textContent = 'Delete Region'
    deleteButton.type = 'button'
    deleteButton.addEventListener('click', () => void this.deleteEffectRegion(track, effectRegion.id))

    this.openEffectPanelInput = valueSlider
    this.openEffectPanelOutput = valueOutput
    this.effectPanelController.open({
      title: 'Gain',
      subtitle: this.getEffectPanelSubtitle(track, effectRegion),
      body: [valueGroup],
      actions: [deleteButton],
      onClose: () => {
        this.openEffectPanelState = null
        this.effectEditStart = null
        this.openEffectPanelInput = null
        this.openEffectPanelOutput = null
      },
    })
  }

  private async commitEffectRegionEdit(track: Track) {
    if (!this.effectEditStart || this.effectEditStart.track != track) {
      return
    }
    const newEffectRegions = this.cloneEffectRegions(track.getEffectRegions())
    if (this.effectArraysEqual(this.effectEditStart.effectRegions, newEffectRegions)) {
      this.effectEditStart = null
      return
    }
    await this.history.recordApplied(
      new SetTrackEffectRegionsCommand(track, this.effectEditStart.effectRegions, newEffectRegions),
    )
    this.effectEditStart = null
  }

  private async deleteEffectRegion(track: Track, effectRegionId: string) {
    const oldEffectRegions = this.cloneEffectRegions(track.getEffectRegions())
    const newEffectRegions = oldEffectRegions.filter((effectRegion) => effectRegion.id != effectRegionId)
    if (newEffectRegions.length == oldEffectRegions.length) {
      return
    }
    this.openEffectPanelState = null
    this.effectEditStart = null
    this.openEffectPanelInput = null
    this.openEffectPanelOutput = null
    this.effectPanelController.hide()
    await this.history.execute(new SetTrackEffectRegionsCommand(track, oldEffectRegions, newEffectRegions))
  }

  private refreshOpenEffectPanel() {
    if (!this.openEffectPanelState) {
      return
    }
    const effectRegion = this.openEffectPanelState.track.getEffectRegionById(this.openEffectPanelState.effectRegionId)
    if (!effectRegion) {
      this.openEffectPanelState = null
      this.effectEditStart = null
      this.openEffectPanelInput = null
      this.openEffectPanelOutput = null
      this.effectPanelController.hide()
      return
    }
    this.effectPanelController.setSubtitle(this.getEffectPanelSubtitle(this.openEffectPanelState.track, effectRegion))
    if (effectRegion.effect == 'gain' && this.openEffectPanelInput && this.openEffectPanelOutput) {
      this.openEffectPanelInput.value = `${effectRegion.value}`
      this.updateGainEffectOutput(this.openEffectPanelOutput, effectRegion.value)
    }
  }

  private getEffectPanelSubtitle(track: Track, effectRegion: Effect) {
    const start = TimeUtils.positionToString(effectRegion.startSample, this.sampleRate, true)
    const end = TimeUtils.positionToString(effectRegion.startSample + effectRegion.length, this.sampleRate, true)
    return `${track.name} · ${start} - ${end}`
  }

  private updateGainEffectOutput(output: HTMLOutputElement, value: number) {
    output.value = `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`
  }

  private cloneEffectRegions(effectRegions: Effect[]) {
    return effectRegions.map((effectRegion) => ({ ...effectRegion }))
  }

  private effectArraysEqual(a: Effect[], b: Effect[]) {
    return (
      a.length == b.length &&
      a.every(
        (effectRegion, index) =>
          effectRegion.id == b[index]?.id &&
          effectRegion.effect == b[index]?.effect &&
          effectRegion.startSample == b[index]?.startSample &&
          effectRegion.length == b[index]?.length &&
          effectRegion.value == b[index]?.value,
      )
    )
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
    this.drawSelection()
    this.positionMarkerController.draw(position)
  }
}
