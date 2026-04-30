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
import { PeakMeterController } from 'ui/PeakMeterController'
import { TrackListTrack as TrackListInfo } from './TrackListTrack'
import { InputListController } from './InputListController'
import { SelectedRegion } from '../../playback/Player'

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
  readonly pointerStateManager = new PointerStateManager(this)

  private selection: Selection | null = null
  private draggedFirstWaveform: Waveform | null = null
  private readonly tracklistElement = document.getElementById('track-list')!
  private readonly tracklistInfoElement = document.getElementById('track-info-list')!
  private readonly infoWaveformPairs = new Map<string, { info: HTMLElement; waveform: HTMLElement }>()

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

  private readonly scrollListener = (event: WheelEvent) => {
    if (event.ctrlKey) {
      this.zoom(event)
      event.preventDefault()
      event.stopPropagation()
    } else if (event.deltaX) {
      this.translate(event.deltaX)
      event.preventDefault()
      event.stopPropagation()
    }
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
      const infoDivs = new Array<Node>()
      const waveformDivs = new Array<Node>()

      const timelineDiv = document.getElementById('timeline')!

      timelineDiv.addEventListener('wheel', this.scrollListener, {
        passive: false,
      })

      const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize)

      for (let i = 0; i < project.getTracks().length; ++i) {
        const track = project.getTracks()[i]
        const existing = this.infoWaveformPairs.get(`${track.id}`)
        if (existing) {
          infoDivs.push(existing.info)
          waveformDivs.push(existing.waveform)
          continue
        }

        const trackInfoDiv = document.createElement('div')
        trackInfoDiv.style.height = `${7 * track.getChannelCount() + 1.5}rem`
        const trackListInfo = new TrackListInfo(track, trackInfoDiv)

        const waveformDiv = document.createElement('div')
        waveformDiv.addEventListener('contextmenu', (mouseEvent) => {
          mouseEvent.preventDefault()
          this.timelineUnselectionContextMenu.draw(mouseEvent.clientX, mouseEvent.clientY)
        })
        waveformDiv.style.height = `${7 * track.getChannelCount() + 1.5}rem`
        waveformDiv.id = `waveform-track-${track.id}`

        waveformDiv.addEventListener('wheel', this.scrollListener, {
          passive: false,
        })

        this.tracklistInfoElement.appendChild(trackInfoDiv)
        this.tracklistElement.appendChild(waveformDiv)

        // const trackPeakMeterController = new PeakMeterController(trackPeakMeterDiv)

        const waveform = new Waveform(this, track, waveformDiv, i)
        this.waveforms.push(waveform)

        new ResizeObserver(async (_) => {
          waveform.resize()
          waveform.draw()
        }).observe(waveformDiv)

        infoDivs.push(trackInfoDiv)
        waveformDivs.push(waveformDiv)
      }
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
    this.pointerStateManager
    this.selection.waveforms.add(waveform)
    this.drawSelection()
  }

  setSelection(startSample: number, endSample: number, waveforms: Set<Waveform>) {
    this.selection = {
      startSample: startSample,
      endSample: endSample,
      waveforms: waveforms,
    }
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
    const hasSelectionAlready = !!this.selection
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
    if (hasSelectionAlready) {
      AudioControl.startPosition = 0
      this.positionMarkerController.draw()
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
    this.waveforms.forEach((w) => w.removeSelection())
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
    newTrack.addClipView(clipView)
    oldWaveform.removeClipView(clipViewController.clipViewIndex)
    await Promise.all([ProjectManager.saveTrack(oldWaveform.track), ProjectManager.saveTrack(newTrack)])
    this.draw()
  }

  async sliceSelection(del: boolean) {
    if (!this.selection) {
      return
    }
    const newClipboard: typeof Clipboard.copiedClipViews = []
    const lowSample = Math.min(this.selection!.startSample, this.selection!.endSample)
    const highSample = Math.max(this.selection!.startSample, this.selection!.endSample)
    this.selection.waveforms.forEach((waveform) => {
      newClipboard.push(waveform.track.slice(lowSample, highSample, del))
      waveform.drawAudioData()
    })
    Clipboard.copiedClipViews = newClipboard
    Clipboard.copyStartPosition = this.selection?.startSample ?? null
    if (del) {
      await Promise.all(this.selection.waveforms.entries().map((w) => {
        
        return ProjectManager.saveTrack(w[0].track)
      }))
    }
  }

  async paste(trackIndex: number, startingSample: number) {
    console.error(startingSample / this.sampleRate + ' ' + Clipboard.copyStartPosition! / this.sampleRate)
    const startPositionDelta = startingSample - Clipboard.copyStartPosition!
    const tracks = (await ProjectManager.getActiveProject()).getTracks()
    const newClipViewsList: typeof Clipboard.copiedClipViews = []
    let i = 0
    console.error(Clipboard.copiedClipViews)
    for await (const clipViews of Clipboard.copiedClipViews!) {
      const track = tracks[trackIndex + i++]
      const newClipViews: Array<ClipView> = []
      clipViews.forEach((clipView) => {
        const newClipView = cloneClipViewWithNewStartPosition(clipView, startPositionDelta)
        console.error(newClipView.startPosition / this.sampleRate)
        if (!track.canAddClipView(newClipView)) {
          console.error('no, not true!!!')
          return
        }
        newClipViews.push(newClipView)
      })
      newClipViewsList.push(newClipViews)
    }
    i = 0
    const savePromises = []
    for (const clipViews of newClipViewsList) {
      const track = tracks[trackIndex + i++]
      for (const clipView of clipViews) {
        track.addClipView(clipView)
      }
      savePromises.push(ProjectManager.saveTrack(track))
    }
    this.draw()
    await Promise.all(savePromises)
  }

  private drawSelection() {
    if (!this.selection || this.selection.startSample == this.selection.endSample) {
      return
    }
    const startSample = Math.min(this.selection!.startSample, this.selection!.endSample)
    const endSample = Math.max(this.selection!.startSample, this.selection!.endSample)
    this.timelineController.drawSelection(startSample, endSample)
    this.waveforms.forEach((w) =>
      this.selection?.waveforms.has(w) ? w.drawSelection(startSample, endSample) : w.removeSelection(),
    )
  }

  draw() {
    this.timelineController.draw()
    this.waveforms.forEach((waveform) => waveform.draw())
    this.drawSelection()
    this.positionMarkerController.draw()
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
