import { Track } from '../../project/Track'
import { ClipView, cloneClipViewWithNewStartPosition } from '../../project/ClipView'
import { TrackListItemController } from './TrackListItemController'
import { TrackListController } from './TrackListController'
import {
  ContextMenuController,
  ContextMenuItem,
  ContextMenuSeparator,
  type ContextMenuTarget,
} from '../../ui/ContextMenuController'
import { SummaryGenerator } from '../../project/SummaryGenerator'
import {
  RemoveClipViewCommand,
  ReplaceClipViewCommand,
  SetTrackClipViewsCommand,
  clipViewsEqual,
} from '../undo/UndoableActions'
import { TimelineRegionController } from './TimelineRegionController'
import { createSvgIcon } from '../SvgIcon'
import type { TrackDisplayMode } from './TrackDisplayMode'
import {
  SpectrogramService,
  type SpectrogramClipPlacement,
  type SpectrogramTrackRenderer,
} from './spectrogram/SpectrogramService'
import { getSpectrogramScaleTicks } from './spectrogram/SpectrogramTiling'
import { spectrogramSettings } from './spectrogram/SpectrogramSettings'
import { TRANSCRIPTION_LANE_HEIGHT, TranscriptionOverlayController } from './TranscriptionOverlay'
import { getTrackTranscriptEntries, type TrackTranscriptEntry } from '../transcript/TrackTranscript'
import { NotificationsController } from '../NotificationsController'
import { announce } from '../LiveAnnouncer'
import { TimeUtils } from '../../global/TimeUtils'
import { VideoThumbnailRenderer } from '../../video/VideoThumbnailRenderer'
import { VIDEO_LANE_HEIGHT } from '../../video/VideoThumbnailLayout'
import type { VideoPlacement } from '../../video/VideoFrameResolver'

let nextClipMenuId = 0

/** Handles displaying a track's waveform. */
export class Waveform extends TrackListItemController {
  static readonly HEADER_HEIGHT = 20
  private readonly PIXEL_RATIO = window.devicePixelRatio || 1

  private static readonly SCALE_TICK_LENGTH = 8
  private static readonly SCALE_LABEL_OFFSET = 11
  private static readonly SCALE_LABEL_HALF_HEIGHT = 7
  private static readonly SCALE_LABEL_SPACING = 16

  topSvgElement: SVGSVGElement

  private readonly clipViewControllerMap = new Map<ClipView, ClipViewController>()
  readonly topGroupElement = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  readonly clipViewGroupElement = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  readonly aboveClipViewGroupElement = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  private readonly axesPathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  private readonly channelSeparatorPathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  private readonly transcriptionLaneElement = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  private readonly color: string
  width = 0
  private height = 0
  private transcriptionLaneHeightValue = 0
  private videoLaneHeightValue = 0
  private readonly transferredClipViews = new Set<ClipView>()
  private readonly videoCanvas = document.createElement('canvas')
  private videoRenderer: VideoThumbnailRenderer | null = null
  private videoDrawFrame = 0
  private mediaOverlayVisible = true

  private readonly dragInProgressClipViews = new Array<ClipViewController>()
  private readonly transientClipViewControllers = new Set<ClipViewController>()
  private readonly spectrogramCanvas = document.createElement('canvas')
  private readonly spectrogramScaleGroupElement = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  private readonly resizeObserver: ResizeObserver
  private trackRenderer: SpectrogramTrackRenderer | null = null
  private spectrogramDrawFrame = 0
  private currentDisplayMode: TrackDisplayMode = 'waveform'
  private spectrogramScaleLayoutKey = ''
  private readonly removeSpectrogramSettingsListener: () => void
  private readonly clipContextMenu: ContextMenuController

  getHeight() {
    return this.height
  }

  get audioLaneTop() {
    return Waveform.HEADER_HEIGHT + this.videoLaneHeight
  }

  get videoLaneHeight() {
    return this.videoLaneHeightValue
  }

  get auxiliaryLaneHeight() {
    return this.videoLaneHeight + this.transcriptionLaneHeight
  }

  get transcriptionLaneTop() {
    return this.audioLaneTop + this.height
  }

  get transcriptionLaneHeight() {
    return this.transcriptionLaneHeightValue
  }

  get fullHeight() {
    return this.transcriptionLaneTop + this.transcriptionLaneHeight
  }

  revealTranscriptLane(): void {
    this.transcriptionLaneElement.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  hitTestTranscript(event: MouseEvent): TrackTranscriptEntry | null {
    if (!this.topSvgElement.isConnected || this.transcriptionLaneHeight === 0) return null
    const matrix = this.topSvgElement.getScreenCTM()
    if (!matrix) return null
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
    if (point.x < 0 || point.x >= this.width || point.y < this.transcriptionLaneTop || point.y >= this.fullHeight)
      return null
    const sample = this.getSampleForXValue(point.x)
    return (
      getTrackTranscriptEntries(this.track).find((entry) => entry.startSample <= sample && sample < entry.endSample) ??
      null
    )
  }

  constructor(
    trackListController: TrackListController,
    readonly track: Track,
    readonly div: HTMLDivElement,
    readonly index: number,
    private readonly spectrogramService: SpectrogramService,
    initialDisplayMode: TrackDisplayMode,
    private readonly resizeTrackForAuxiliaryLanes: (heightDelta: number) => void,
    private readonly projectDirectory: string,
  ) {
    super(trackListController)
    this.color = `var(--waveform-${index})`
    div.classList = 'waveform tracklist-item'
    this.spectrogramCanvas.className = 'spectrogram-canvas'
    this.spectrogramCanvas.setAttribute('aria-hidden', 'true')
    this.div.appendChild(this.spectrogramCanvas)
    this.videoCanvas.className = 'video-thumbnail-canvas'
    this.videoCanvas.setAttribute('aria-hidden', 'true')
    this.videoCanvas.hidden = true
    this.div.appendChild(this.videoCanvas)
    div.addEventListener('dblclick', (event) => {
      trackListController.selectTrack(this)
    })
    this.topSvgElement = this.getTopSvgElement()
    this.topSvgElement.addEventListener('mouseenter', (mouseEvent) => {
      this.trackListController.pointerStateManager.setPointedOverTrack(this)
    })
    this.topSvgElement.addEventListener('mouseleave', (mouseEvent) => {
      this.trackListController.pointerStateManager.removePointedOverTrack(this)
    })

    this.transcriptionLaneElement.classList.add('transcription-lane')
    this.transcriptionLaneElement.setAttribute('aria-hidden', 'true')
    this.topSvgElement.appendChild(this.transcriptionLaneElement)
    this.topSvgElement.appendChild(this.clipViewGroupElement)
    this.topSvgElement.appendChild(this.topGroupElement)

    this.topSvgElement.appendChild(this.axesPathElement)
    this.axesPathElement.classList.add('waveform-axes-path')
    this.axesPathElement.setAttribute('aria-hidden', 'true')

    this.channelSeparatorPathElement.classList.add('waveform-channel-separator')
    this.channelSeparatorPathElement.setAttribute('aria-hidden', 'true')
    this.topSvgElement.appendChild(this.channelSeparatorPathElement)
    this.topSvgElement.appendChild(this.aboveClipViewGroupElement)
    this.spectrogramScaleGroupElement.classList.add('spectrogram-scale')
    this.spectrogramScaleGroupElement.setAttribute('aria-hidden', 'true')
    this.topSvgElement.appendChild(this.spectrogramScaleGroupElement)
    this.removeSpectrogramSettingsListener = spectrogramSettings.addChangeListener(() => {
      if (this.currentDisplayMode === 'spectrogram') this.drawSpectrogramScale()
    })
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(this.div)
    if (initialDisplayMode === 'spectrogram') this.setDisplayMode(initialDisplayMode)
    this.clipContextMenu = this.createClipContextMenu()
  }

  openClipContextMenu(x: number, y: number, target?: ContextMenuTarget): void {
    this.clipContextMenu.draw(x, y, target)
  }

  clipViewAt(sample: number): ClipView | null {
    return (
      this.track.clipViews.find((clipView) => clipView.startPosition <= sample && sample < clipView.getEndPosition()) ??
      null
    )
  }

  private createClipContextMenu(): ContextMenuController {
    const withClip = (action: (clipView: ClipView, sample: number) => unknown) => (_: number, sample: number) => {
      const clipView = this.clipViewAt(sample)
      if (clipView === null) return
      return action(clipView, sample)
    }
    return new ContextMenuController(
      `clip-contextmenu-${++nextClipMenuId}`,
      'Clip actions',
      this.trackListController.pointerStateManager,
      new ContextMenuItem(
        'Split here',
        withClip((clipView, sample) => this.splitClipView(clipView, sample)),
      ),
      new ContextMenuItem(
        'Move clip to time…',
        withClip((clipView) => this.openMoveClipDialog(clipView)),
      ),
      new ContextMenuItem(
        'Set clip start…',
        withClip((clipView) => this.openClipStartDialog(clipView)),
      ),
      new ContextMenuItem(
        'Set clip end…',
        withClip((clipView) => this.openClipEndDialog(clipView)),
      ),
      new ContextMenuItem(
        'Move to new track',
        withClip((clipView) => {
          void this.trackListController.transferClipViewToNewTrack(this.track, clipView, 0)
        }),
      ),
      new ContextMenuItem(
        'Select clip',
        withClip((clipView) => this.trackListController.selectClipView(clipView, this)),
      ),
      new ContextMenuItem(
        'Clip info…',
        withClip((clipView) => (window as any).clipManagerController?.openClipInfo?.(clipView.clip)),
      ),
      new ContextMenuSeparator(),
      new ContextMenuItem(
        'Delete clip',
        withClip(async (clipView) => {
          await this.trackListController.history.execute(new RemoveClipViewCommand(clipView, this.track))
          announce(`Deleted clip ${clipView.clip.name}`)
        }),
      ),
    )
  }

  private samplesToMs(samples: number): number {
    return Math.round((samples * 1000) / this.sampleRate)
  }

  private msToSamples(ms: number): number {
    return Math.round((ms * this.sampleRate) / 1000)
  }

  private positionString(samples: number): string {
    return TimeUtils.positionToString(samples, this.sampleRate, true)
  }

  private async splitClipView(clipView: ClipView, position: number) {
    const clipViewIndex = this.track.clipViews.indexOf(clipView)
    if (clipViewIndex < 0) {
      return
    }
    if (position <= clipView.startPosition || position >= clipView.getEndPosition()) {
      return
    }
    const firstLength = position - clipView.startPosition
    const firstNewClipView = new ClipView(clipView.clip, clipView.offset, clipView.startPosition, firstLength)
    const secondNewClipView = new ClipView(
      clipView.clip,
      clipView.offset + firstLength,
      position,
      clipView.length - firstLength,
    )
    const oldClipViews = this.track.clipViews.slice()
    const newClipViews = oldClipViews.slice()
    newClipViews.splice(clipViewIndex, 1, firstNewClipView, secondNewClipView)
    await this.trackListController.history.execute(new SetTrackClipViewsCommand(this.track, oldClipViews, newClipViews))
    announce('Split clip')
  }

  private openMoveClipDialog(clipView: ClipView) {
    this.trackListController.openTimeEntry({
      title: 'Move clip to time',
      submitLabel: 'Move',
      initialMs: this.samplesToMs(clipView.startPosition),
      onSubmit: (ms) => {
        const newStart = this.msToSamples(ms)
        void this.replaceClipView(
          clipView,
          new ClipView(clipView.clip, clipView.offset, newStart, clipView.length),
          'move clip view',
          `Moved clip to ${TimeUtils.toSpokenString(this.samplesToMs(newStart))}`,
        )
      },
    })
  }

  private openClipStartDialog(clipView: ClipView) {
    this.trackListController.openTimeEntry({
      title: 'Set clip start',
      submitLabel: 'Set',
      initialMs: this.samplesToMs(clipView.startPosition),
      onSubmit: (ms) => {
        const newStart = this.msToSamples(ms)
        const shift = newStart - clipView.startPosition
        if (shift < -clipView.offset || shift >= clipView.length) {
          const min = this.positionString(clipView.startPosition - clipView.offset)
          const max = this.positionString(clipView.getEndPosition() - 1)
          NotificationsController.showShortDurationMessage(`The clip can start between ${min} and ${max}.`)
          return
        }
        void this.replaceClipView(
          clipView,
          new ClipView(clipView.clip, clipView.offset + shift, clipView.startPosition + shift, clipView.length - shift),
          'resize clip view',
          `Clip starts at ${TimeUtils.toSpokenString(this.samplesToMs(newStart))}`,
        )
      },
    })
  }

  private openClipEndDialog(clipView: ClipView) {
    this.trackListController.openTimeEntry({
      title: 'Set clip end',
      submitLabel: 'Set',
      initialMs: this.samplesToMs(clipView.getEndPosition()),
      onSubmit: (ms) => {
        const newEnd = this.msToSamples(ms)
        const newLength = newEnd - clipView.startPosition
        const maxLength = clipView.clip.length - clipView.offset
        if (newLength <= 0 || newLength > maxLength) {
          const min = this.positionString(clipView.startPosition + 1)
          const max = this.positionString(clipView.startPosition + maxLength)
          NotificationsController.showShortDurationMessage(`The clip can end between ${min} and ${max}.`)
          return
        }
        void this.replaceClipView(
          clipView,
          new ClipView(clipView.clip, clipView.offset, clipView.startPosition, newLength),
          'resize clip view',
          `Clip ends at ${TimeUtils.toSpokenString(this.samplesToMs(newEnd))}`,
        )
      },
    })
  }

  private async replaceClipView(old: ClipView, replacement: ClipView, description: string, announcement: string) {
    const index = this.track.clipViews.indexOf(old)
    if (index < 0 || clipViewsEqual(old, replacement)) {
      return
    }
    if (!this.track.canReplaceClipView(index, replacement)) {
      NotificationsController.showShortDurationMessage('That would overlap another clip on this track.')
      return
    }
    await this.trackListController.history.execute(
      new ReplaceClipViewCommand(this.track, old, replacement, description),
    )
    announce(announcement)
  }

  get displayMode(): TrackDisplayMode {
    return this.currentDisplayMode
  }

  get spectrogramFallbackColor(): string {
    return this.spectrogramService.fallbackColor
  }

  setDisplayMode(mode: TrackDisplayMode): void {
    if (mode === this.currentDisplayMode) return
    this.currentDisplayMode = mode
    const spectrogramMode = mode === 'spectrogram'
    this.div.classList.toggle('spectrogram-mode', spectrogramMode)
    this.div.classList.toggle('spectrogram-fallback-visible', spectrogramMode)
    for (const controller of this.getClipViewControllers()) {
      controller.setDisplayMode(mode)
      if (spectrogramMode) controller.updateSpectrogramFallbackFill()
    }

    if (spectrogramMode) {
      this.requestSpectrogramDraw()
      this.drawSpectrogramScale()
    } else {
      if (this.spectrogramDrawFrame !== 0) cancelAnimationFrame(this.spectrogramDrawFrame)
      this.spectrogramDrawFrame = 0
      this.trackRenderer?.clear()
      this.draw()
    }
  }

  requestSpectrogramDraw(): void {
    if (this.currentDisplayMode !== 'spectrogram' || this.spectrogramDrawFrame !== 0) return
    this.spectrogramDrawFrame = requestAnimationFrame(() => {
      this.spectrogramDrawFrame = 0
      if (this.currentDisplayMode !== 'spectrogram') return
      this.trackRenderer ??= this.spectrogramService.createTrackRenderer(this.spectrogramCanvas, (available) => {
        if (!available) {
          for (const controller of this.getClipViewControllers()) controller.updateSpectrogramFallbackFill()
        }
        this.div.classList.toggle(
          'spectrogram-fallback-visible',
          this.currentDisplayMode === 'spectrogram' && !available,
        )
      })
      const placements = new Array<SpectrogramClipPlacement>()
      for (const clipView of this.track.clipViews) {
        const controller = this.clipViewControllerMap.get(clipView)
        if (controller !== undefined && clipView.clip.audioPresent)
          placements.push(controller.getSpectrogramPlacement())
      }
      for (const controller of this.transientClipViewControllers) {
        if (controller.clipView.clip.audioPresent) placements.push(controller.getSpectrogramPlacement())
      }
      this.trackRenderer.draw({
        cssWidth: this.width,
        cssHeight: this.transcriptionLaneTop,
        dpr: window.devicePixelRatio || 1,
        timelineStart: this.getSampleForXValue(0),
        samplesPerCssPixel: this.samplesPerUnit,
        headerHeight: this.audioLaneTop,
        channelCount: this.track.getChannelCount(),
        clips: placements,
      })
    })
  }

  setMediaOverlayVisible(visible: boolean): void {
    this.mediaOverlayVisible = visible
    this.videoCanvas.hidden = !visible || this.videoLaneHeight === 0
    if (visible) this.requestVideoDraw()
    else {
      if (this.videoDrawFrame !== 0) cancelAnimationFrame(this.videoDrawFrame)
      this.videoDrawFrame = 0
      this.videoRenderer?.clear()
    }
  }

  requestVideoDraw(): void {
    if (!this.mediaOverlayVisible || this.videoLaneHeight === 0 || this.videoDrawFrame !== 0) return
    this.videoDrawFrame = requestAnimationFrame(() => {
      this.videoDrawFrame = 0
      if (!this.mediaOverlayVisible || this.videoLaneHeight === 0) return
      this.videoRenderer ??= new VideoThumbnailRenderer(this.videoCanvas, (error) => {
        NotificationsController.showShortDurationMessage(`Video thumbnails: ${error.message}`)
      })
      this.videoRenderer.draw({
        projectDirectory: this.projectDirectory,
        sampleRate: this.sampleRate,
        timelineStart: this.getSampleForXValue(0),
        samplesPerPixel: this.samplesPerUnit,
        cssWidth: this.width,
        cssHeight: this.videoLaneHeight,
        dpr: window.devicePixelRatio || 1,
        placements: this.getVideoPlacements(),
      })
    })
  }

  private getVideoPlacements(): VideoPlacement[] {
    const placements: VideoPlacement[] = []
    for (const clipView of this.track.clipViews) {
      if (this.transferredClipViews.has(clipView) || clipView.clip.videoSegments.length === 0) continue
      const controller = this.clipViewControllerMap.get(clipView)
      placements.push(controller?.getVideoPlacement() ?? clipView)
    }
    for (const controller of this.transientClipViewControllers) {
      if (controller.clipView.clip.videoSegments.length > 0) placements.push(controller.getVideoPlacement())
    }
    return placements
  }

  remove(): void {
    if (this.videoDrawFrame !== 0) cancelAnimationFrame(this.videoDrawFrame)
    this.videoDrawFrame = 0
    this.videoRenderer?.destroy()
    this.videoRenderer = null
    if (this.spectrogramDrawFrame !== 0) cancelAnimationFrame(this.spectrogramDrawFrame)
    this.spectrogramDrawFrame = 0
    this.removeSpectrogramSettingsListener()
    this.clipContextMenu.remove()
    this.resizeObserver.disconnect()
    this.trackRenderer?.destroy()
    this.trackRenderer = null
    for (const controller of this.getClipViewControllers()) controller.remove()
    this.clipViewControllerMap.clear()
    this.transientClipViewControllers.clear()
  }

  private getClipViewControllers(): Set<ClipViewController> {
    return new Set([...this.clipViewControllerMap.values(), ...this.transientClipViewControllers])
  }

  private getTopSvgElement(): SVGSVGElement {
    if (this.topSvgElement == null) {
      this.topSvgElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      this.topSvgElement.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
      this.topSvgElement.id = `waveform-parent-${this.track.id}`
      this.div.appendChild(this.topSvgElement)
    }
    this.topSvgElement.setAttribute('viewBox', `0 0 ${this.width} ${this.fullHeight}`)

    return this.topSvgElement
  }

  /**
   * Draws the waveform.
   */
  draw() {
    this.updateLayout()
    const topSvgElement = this.getTopSvgElement()

    this.drawAudioDataForCanvasXRange(this, topSvgElement, 0, this.width)
    this.drawAxes()
    this.drawSpectrogramScale()
  }

  drawAudioData() {
    this.drawAudioDataForCanvasXRange(this, this.getTopSvgElement(), 0, this.width)
  }

  /** Redraws just the transcript lanes, as a boundary drag does on every pointer move. */
  drawTranscriptionOverlays() {
    const startSample = this.getSampleForXValue(0)
    const endSample = this.getSampleForXValue(this.width)
    for (const controller of this.getClipViewControllers()) {
      controller.drawTranscriptionOverlay(startSample, endSample)
    }
  }

  resize() {
    this.draw()
  }

  private updateLayout(): void {
    for (const clipView of this.transferredClipViews) {
      if (!this.track.clipViews.includes(clipView)) this.transferredClipViews.delete(clipView)
    }
    const placements = this.getVideoPlacements()
    const videoLaneHeight = placements.length > 0 ? VIDEO_LANE_HEIGHT : 0
    const transcriptionLaneHeight = this.track.clipViews.some((clipView) => clipView.clip.transcription.length > 0)
      ? TRANSCRIPTION_LANE_HEIGHT
      : 0
    const auxiliaryLanesChanged =
      transcriptionLaneHeight !== this.transcriptionLaneHeightValue || videoLaneHeight !== this.videoLaneHeightValue
    if (auxiliaryLanesChanged) {
      const heightDelta = videoLaneHeight + transcriptionLaneHeight - this.auxiliaryLaneHeight
      this.transcriptionLaneHeightValue = transcriptionLaneHeight
      this.videoLaneHeightValue = videoLaneHeight
      this.resizeTrackForAuxiliaryLanes(heightDelta)
      this.videoCanvas.hidden = !this.mediaOverlayVisible || videoLaneHeight === 0
      this.div.classList.toggle('has-video-lane', videoLaneHeight > 0)
      if (videoLaneHeight === 0) {
        if (this.videoDrawFrame !== 0) cancelAnimationFrame(this.videoDrawFrame)
        this.videoDrawFrame = 0
        this.videoRenderer?.clear()
      }
    }

    const width = this.div.clientWidth
    const height = Math.max(0, this.div.clientHeight - Waveform.HEADER_HEIGHT - this.auxiliaryLaneHeight)
    if (!auxiliaryLanesChanged && width === this.width && height === this.height) return

    this.width = width
    this.height = height
    this.topSvgElement.setAttribute('viewBox', `0 0 ${this.width} ${this.fullHeight}`)
    this.transcriptionLaneElement.setAttribute('x', '0')
    this.transcriptionLaneElement.setAttribute('y', `${this.transcriptionLaneTop}`)
    this.transcriptionLaneElement.setAttribute('width', `${this.width}`)
    this.transcriptionLaneElement.setAttribute('height', `${this.transcriptionLaneHeight}`)
    this.transcriptionLaneElement.toggleAttribute('hidden', this.transcriptionLaneHeight === 0)
    this.spectrogramCanvas.style.height = `${this.transcriptionLaneTop}px`
    this.videoCanvas.style.top = `${Waveform.HEADER_HEIGHT}px`
    this.videoCanvas.style.height = `${this.videoLaneHeight}px`
    if (auxiliaryLanesChanged) this.trackListController.selectionController.draw()
  }

  private drawAxes() {
    const channelHeight = this.height / this.track.getChannelCount()

    let axesPath = `M 1 ${this.audioLaneTop} L 1 ${this.transcriptionLaneTop} `
    let channelSeparatorPath = ''
    for (let channel = 0; channel < this.track.getChannelCount(); ++channel) {
      const xAxis = this.audioLaneTop + channel * channelHeight + channelHeight / 2
      axesPath += `M 0 ${xAxis} L ${this.width * this.PIXEL_RATIO} ${xAxis}`

      if (channel > 0) {
        channelSeparatorPath +=
          `M 0 ${this.audioLaneTop + channel * channelHeight}` +
          `L ${this.width * this.PIXEL_RATIO} ${this.audioLaneTop + channel * channelHeight}`
      }
    }
    this.axesPathElement.setAttribute('d', axesPath)
    this.channelSeparatorPathElement.setAttribute('d', channelSeparatorPath)
  }

  /**
   * Draws the mel-warped frequency scale along the left edge of each channel while the
   * spectrogram is visible; ticks stay at their exact frequency and edge labels are nudged
   * fully inside the channel so the top and bottom entries never clip.
   */
  private drawSpectrogramScale(): void {
    const channelCount = this.track.getChannelCount()
    const channelHeight = channelCount > 0 ? this.height / channelCount : 0
    const layoutKey = `${this.currentDisplayMode}|${this.audioLaneTop}|${this.height}|${channelCount}|${spectrogramSettings.current.frequencyBands}|${this.sampleRate}`
    if (layoutKey === this.spectrogramScaleLayoutKey) return
    this.spectrogramScaleLayoutKey = layoutKey

    if (this.currentDisplayMode !== 'spectrogram' || channelHeight <= 0) {
      this.spectrogramScaleGroupElement.replaceChildren()
      return
    }

    const ticks = getSpectrogramScaleTicks(
      spectrogramSettings.current.frequencyBands,
      this.sampleRate,
      channelHeight,
      Waveform.SCALE_LABEL_SPACING,
    )
    const scaleFragment = document.createDocumentFragment()
    for (let channel = 0; channel < channelCount; ++channel) {
      const channelBottom = this.audioLaneTop + (channel + 1) * channelHeight
      const channelTop = channelBottom - channelHeight
      for (const tick of ticks) {
        const y = channelBottom - tick.fraction * channelHeight
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
        line.setAttribute('x1', '0')
        line.setAttribute('x2', `${Waveform.SCALE_TICK_LENGTH}`)
        line.setAttribute('y1', `${y}`)
        line.setAttribute('y2', `${y}`)
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text')
        label.setAttribute('x', `${Waveform.SCALE_LABEL_OFFSET}`)
        label.setAttribute(
          'y',
          `${Math.min(channelBottom - Waveform.SCALE_LABEL_HALF_HEIGHT, Math.max(channelTop + Waveform.SCALE_LABEL_HALF_HEIGHT, y))}`,
        )
        label.textContent = tick.label
        scaleFragment.append(line, label)
      }
    }
    this.spectrogramScaleGroupElement.replaceChildren(scaleFragment)
  }

  releaseClipViewController(controller: ClipViewController, transferred = false) {
    if (transferred) this.transferredClipViews.add(controller.clipView)
    if (this.clipViewControllerMap.get(controller.clipView) == controller) {
      this.clipViewControllerMap.delete(controller.clipView)
    }
    this.transientClipViewControllers.delete(controller)
  }

  adoptClipViewController(controller: ClipViewController) {
    this.transferredClipViews.delete(controller.clipView)
    if (!this.track.clipViews.includes(controller.clipView)) {
      this.transientClipViewControllers.add(controller)
      return
    }
    this.transientClipViewControllers.delete(controller)
    const existingController = this.clipViewControllerMap.get(controller.clipView)
    if (existingController && existingController != controller) {
      existingController.remove()
    }
    this.clipViewControllerMap.set(controller.clipView, controller)
  }

  removeClipViewController(controller: ClipViewController) {
    this.releaseClipViewController(controller)
    controller.remove()
  }

  private async drawAudioDataForCanvasXRange(
    waveform: Waveform,
    topSvgElement: SVGSVGElement,
    start: number,
    end: number,
  ) {
    for (const [clipView, clipViewController] of this.clipViewControllerMap) {
      if (!this.track.clipViews.includes(clipView)) {
        clipViewController.remove()
        this.clipViewControllerMap.delete(clipView)
      }
    }

    const startSample = waveform.getSampleForXValue(start)
    const endSample = waveform.getSampleForXValue(end)
    for (let clipViewIndex = 0; clipViewIndex < waveform.track.clipViews.length; ++clipViewIndex) {
      const currentClipView = waveform.track.clipViews[clipViewIndex]
      if (this.transferredClipViews.has(currentClipView)) continue
      let clipViewController = this.clipViewControllerMap.get(currentClipView)
      if (
        currentClipView.startPosition < endSample &&
        currentClipView.startPosition + currentClipView.length > startSample
      ) {
        if (!clipViewController) {
          clipViewController = new ClipViewController(
            this.trackListController,
            currentClipView,
            this,
            clipViewIndex,
            this.color,
          )
          this.clipViewControllerMap.set(currentClipView, clipViewController)
        } else {
          clipViewController.clipViewIndex = clipViewIndex
        }
        let startCrossFadeDuration = 0,
          endCrossFadeDuration = 0
        if (clipViewIndex > 0) {
          startCrossFadeDuration = Math.max(
            0,
            waveform.track.clipViews[clipViewIndex - 1].getEndPosition() - currentClipView.startPosition,
          )
        }
        if (clipViewIndex < waveform.track.clipViews.length - 1) {
          endCrossFadeDuration = Math.max(
            0,
            currentClipView.getEndPosition() - waveform.track.clipViews[clipViewIndex + 1].startPosition,
          )
        }
        clipViewController.startCrossFadeDuration = startCrossFadeDuration
        clipViewController.endCrossFadeDuration = endCrossFadeDuration
        clipViewController.draw(startSample, endSample)
      } else if (clipViewController) {
        this.removeClipViewController(clipViewController)
      }
    }
    this.orderHandleGroups(waveform.track.clipViews)
    this.requestSpectrogramDraw()
    this.requestVideoDraw()
  }

  /** Keeps tab order along the timeline: each clip's boundary handles follow earlier clips'. */
  private orderHandleGroups(clipViews: readonly ClipView[]) {
    const groups = new Array<SVGGElement>()
    for (const clipView of clipViews) {
      const group = this.clipViewControllerMap.get(clipView)?.handleElementsGroup
      if (group?.parentNode === this.aboveClipViewGroupElement) groups.push(group)
    }
    const ordered = groups.every(
      (group, index) =>
        index === 0 || (groups[index - 1].compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
    )
    if (ordered) return
    // Moving a node blurs it, so the group holding focus stays put and the others move around it.
    const anchor = groups.findIndex((group) => group.contains(document.activeElement))
    if (anchor < 0) {
      for (const group of groups) this.aboveClipViewGroupElement.appendChild(group)
      return
    }
    for (let index = anchor - 1; index >= 0; --index) groups[index + 1].before(groups[index])
    for (let index = anchor + 1; index < groups.length; ++index) groups[index - 1].after(groups[index])
  }

  drawClipViewOver(clipViewController: ClipViewController) {
    this.resetAfterDrawnOver(clipViewController.clipView)

    let startOverlap = 0,
      endOverlap = 0
    for (const clipView of this.track.clipViews) {
      if (clipView == clipViewController.clipView) {
        continue
      }
      const startsBefore = clipView.startPosition < clipViewController.startPosition
      const endsBefore = clipView.getEndPosition() < clipViewController.endPosition
      if (startsBefore) {
        if (!endsBefore) {
          // one envelopes the other - invalid
        } else {
          startOverlap = Math.max(0, clipView.getEndPosition() - clipViewController.startPosition)
          const controller = this.clipViewControllerMap.get(clipView)!
          controller.endCrossFadeDuration = startOverlap
          controller.draw(this.getSampleForXValue(0), this.getSampleForXValue(this.width))
          this.dragInProgressClipViews.push(controller)
        }
      } else {
        if (endsBefore) {
          // one envelopes the other - invalid
        } else {
          endOverlap = Math.max(0, clipViewController.endPosition - clipView.startPosition)
          const controller = this.clipViewControllerMap.get(clipView)!
          controller.startCrossFadeDuration = endOverlap
          controller.draw(this.getSampleForXValue(0), this.getSampleForXValue(this.width))
          this.dragInProgressClipViews.push(controller)
        }
      }
    }
    clipViewController.startCrossFadeDuration = startOverlap
    clipViewController.endCrossFadeDuration = endOverlap
    if (this != clipViewController.waveform) {
      clipViewController.switchParent(this)
    } else {
      clipViewController.draw(this.getSampleForXValue(0), this.getSampleForXValue(this.width))
    }
  }

  resetAfterDrawnOver(excludedClipView?: ClipView) {
    const controllersToReset = new Set(this.dragInProgressClipViews)
    if (excludedClipView) {
      const excludedIndex = this.track.clipViews.indexOf(excludedClipView)
      const previousClipView = this.track.clipViews[excludedIndex - 1]
      const nextClipView = this.track.clipViews[excludedIndex + 1]
      const previousController = previousClipView && this.clipViewControllerMap.get(previousClipView)
      const nextController = nextClipView && this.clipViewControllerMap.get(nextClipView)
      if (previousController) {
        controllersToReset.add(previousController)
      }
      if (nextController) {
        controllersToReset.add(nextController)
      }
    }

    const clipViews = excludedClipView
      ? this.track.clipViews.filter((clipView) => clipView != excludedClipView)
      : this.track.clipViews
    controllersToReset.forEach((clipViewController) => {
      const clipViewIndex = clipViews.indexOf(clipViewController.clipView)
      const previousClipView = clipViews[clipViewIndex - 1]
      const nextClipView = clipViews[clipViewIndex + 1]
      clipViewController.startCrossFadeDuration = previousClipView
        ? Math.max(0, previousClipView.getEndPosition() - clipViewController.startPosition)
        : 0
      clipViewController.endCrossFadeDuration = nextClipView
        ? Math.max(0, clipViewController.endPosition - nextClipView.startPosition)
        : 0
      clipViewController.reset()
    })
    this.dragInProgressClipViews.splice(0)
  }
}

export class ClipViewController extends TrackListItemController {
  startCrossFadeDuration = 0
  endCrossFadeDuration = 0
  public draggedShift = 0
  private readonly clipElementsGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  private readonly videoHitElement = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  readonly handleElementsGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g')

  readonly rectElement = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  private readonly spectrogramFallbackElement = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  readonly headerElement = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  readonly headerTitleElement = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject')
  private readonly noAudioLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text')
  readonly headerInfoElement = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject')
  readonly endCrossFadeHeaderElement = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  readonly endCrossFadeHeaderTitleElement = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject')
  readonly startCrossFadePathElement = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'path',
  ) as unknown as SVGPathElement
  readonly svgPathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path') as unknown as SVGPathElement
  readonly endCrossFadePathElement = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'path',
  ) as unknown as SVGPathElement
  readonly leftHandle = document.createElementNS('http://www.w3.org/2000/svg', 'line') as unknown as SVGLineElement
  readonly rightHandle = document.createElementNS('http://www.w3.org/2000/svg', 'line') as unknown as SVGLineElement
  private readonly fullClipGrayFilter = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  private readonly headerTitleDivElement = document.createElement('div')
  private readonly endCrossFadeHeaderTitleDivElement = document.createElement('div')

  private readonly infoButton = document.createElement('button')
  private pathElementTranslation = 0
  private fullClipPreview = false
  private readonly transcriptionOverlay: TranscriptionOverlayController
  private resizeInfo: {
    side: 'left' | 'right'
    oldStartX: number
    oldWidth: number
    fullClipStartX: number
    fullClipEndX: number
  } | null = null

  constructor(
    readonly trackListController: TrackListController,
    readonly clipView: ClipView,
    public waveform: Waveform,
    public clipViewIndex: number,
    private readonly color: string,
  ) {
    super(trackListController)

    this.headerTitleDivElement.innerText = this.clipView.clip.name
    this.headerTitleElement.appendChild(this.headerTitleDivElement)
    this.noAudioLabel.textContent = 'No audio'
    this.noAudioLabel.classList.add('clip-no-audio-label')
    this.noAudioLabel.setAttribute('text-anchor', 'middle')
    this.noAudioLabel.setAttribute('pointer-events', 'none')
    this.noAudioLabel.setAttribute('aria-hidden', 'true')
    this.headerTitleElement.setAttribute('aria-hidden', 'true')
    this.endCrossFadeHeaderTitleElement.setAttribute('aria-hidden', 'true')
    this.headerTitleElement.classList.add('clip-view-header-title')

    this.waveform.clipViewGroupElement.appendChild(this.clipElementsGroup)
    this.waveform.aboveClipViewGroupElement.appendChild(this.handleElementsGroup)
    this.clipElementsGroup.appendChild(this.spectrogramFallbackElement)
    this.clipElementsGroup.appendChild(this.videoHitElement)
    this.videoHitElement.classList.add('video-lane-hit-rect')
    this.videoHitElement.setAttribute('role', 'img')
    this.videoHitElement.setAttribute(
      'aria-label',
      `Video channel for ${clipView.clip.name}; ${clipView.clip.audioPresent ? 'linked to audio' : 'no audio'}`,
    )
    this.videoHitElement.addEventListener('dblclick', (event) => {
      trackListController.selectClipView(clipView, this.waveform)
      event.stopPropagation()
    })
    this.videoHitElement.addEventListener('contextmenu', (event) => {
      event.preventDefault()
      event.stopPropagation()
      this.waveform.openClipContextMenu(event.clientX, event.clientY)
    })
    this.videoHitElement.addEventListener('mouseenter', () => {
      this.trackListController.pointerStateManager.setPointedOverClipView(this)
    })
    this.videoHitElement.addEventListener('mouseleave', () => {
      this.trackListController.pointerStateManager.removePointedOverClipView(this)
    })
    this.clipElementsGroup.appendChild(this.rectElement)
    this.clipElementsGroup.appendChild(this.headerElement)
    this.clipElementsGroup.appendChild(this.headerTitleElement)
    this.clipElementsGroup.appendChild(this.headerInfoElement)
    this.clipElementsGroup.appendChild(this.fullClipGrayFilter)
    this.rectElement.setAttribute('y', `${this.waveform.audioLaneTop}`)
    this.rectElement.setAttribute('height', `${this.waveformHeight}`)
    this.rectElement.classList = 'waveform-rect'
    this.rectElement.style.setProperty('--waveform-color', this.color)
    this.rectElement.addEventListener('dblclick', (event) => {
      trackListController.selectClipView(clipView, this.waveform)
      event.stopPropagation()
    })

    this.rectElement.setAttribute('x', '0')
    this.spectrogramFallbackElement.setAttribute('y', `${this.waveform.audioLaneTop}`)
    this.spectrogramFallbackElement.setAttribute('height', `${this.waveformHeight}`)
    this.spectrogramFallbackElement.classList.add('spectrogram-fallback')
    this.updateSpectrogramFallbackFill()

    this.headerElement.setAttribute('y', '0')
    this.headerElement.height.baseVal.value = Waveform.HEADER_HEIGHT
    this.headerElement.classList.add('clip-view-header')
    this.headerTitleElement.y.baseVal.value = 0
    this.headerTitleElement.height.baseVal.value = Waveform.HEADER_HEIGHT
    this.endCrossFadeHeaderElement.classList.add('clip-view-crossfade-header')
    this.endCrossFadeHeaderElement.setAttribute('y', '0')
    this.endCrossFadeHeaderElement.setAttribute('height', `${Waveform.HEADER_HEIGHT}`)
    this.endCrossFadeHeaderTitleDivElement.textContent = 'crossfade'
    this.endCrossFadeHeaderTitleElement.classList.add('clip-view-crossfade-header-title')
    this.endCrossFadeHeaderTitleElement.appendChild(this.endCrossFadeHeaderTitleDivElement)
    this.endCrossFadeHeaderTitleElement.y.baseVal.value = 0
    this.endCrossFadeHeaderTitleElement.height.baseVal.value = Waveform.HEADER_HEIGHT

    const infoButton = this.infoButton
    infoButton.type = 'button'
    infoButton.className = 'clip-view-info-button clickable'
    infoButton.title = 'Clip info'
    infoButton.setAttribute('aria-label', `View info for ${this.clipView.clip.name}`)
    infoButton.appendChild(createSvgIcon('three-dots'))
    infoButton.addEventListener('mousedown', (event) => event.stopPropagation())
    infoButton.addEventListener('click', (event) => {
      event.stopPropagation()
      ;(window as any).clipManagerController?.openClipInfo?.(this.clipView.clip)
    })
    this.headerInfoElement.appendChild(infoButton)
    this.headerInfoElement.y.baseVal.value = 0
    this.headerInfoElement.height.baseVal.value = Waveform.HEADER_HEIGHT

    this.handleElementsGroup.appendChild(this.leftHandle)
    this.leftHandle.setAttribute('y1', '0')
    this.leftHandle.setAttribute('y2', `${this.waveform.transcriptionLaneTop}`)
    this.leftHandle.classList = 'clip-view-handle clip-view-handle-left'

    this.leftHandle.setAttribute('x1', '0')
    this.leftHandle.setAttribute('x2', '0')
    this.leftHandle.classList.toggle('clip-view-handle-trimmed', this.clipView.offset > 0)

    this.leftHandle.addEventListener('mousedown', this.leftHandleMouseDownListener)
    this.rightHandle.addEventListener('mousedown', this.rightHandleMouseDownListener)

    this.handleElementsGroup.appendChild(this.rightHandle)
    this.rightHandle.setAttribute('y1', '0')
    this.rightHandle.setAttribute('y2', `${this.waveform.transcriptionLaneTop}`)
    this.rightHandle.classList = 'clip-view-handle clip-view-handle-right'

    this.rightHandle.classList.toggle('clip-view-handle-trimmed', this.clipView.length < this.clipView.clip.length)

    this.clipElementsGroup.appendChild(this.endCrossFadeHeaderElement)
    this.clipElementsGroup.appendChild(this.endCrossFadeHeaderTitleElement)
    this.clipElementsGroup.appendChild(this.svgPathElement)
    this.clipElementsGroup.appendChild(this.startCrossFadePathElement)
    this.clipElementsGroup.appendChild(this.endCrossFadePathElement)
    this.clipElementsGroup.appendChild(this.noAudioLabel)
    this.transcriptionOverlay = new TranscriptionOverlayController(
      this.trackListController,
      this.clipView.clip,
      this.clipElementsGroup,
      this.handleElementsGroup,
    )

    this.svgPathElement.classList = 'waveform-path'
    this.startCrossFadePathElement.classList = 'waveform-path waveform-crossfade-path'
    this.endCrossFadePathElement.classList = 'waveform-path waveform-crossfade-path'
    this.fullClipGrayFilter.classList.add('clip-view-trim-overlay')

    this.headerElement.addEventListener('mousedown', (event) => {
      if (event.button == 0 && event.buttons == 1) {
        this.startClipViewMove(this, event)
      }
    })
    this.headerElement.addEventListener('contextmenu', (event) => {
      event.stopPropagation()
    })
    this.rectElement.addEventListener('contextmenu', (event) => {
      event.preventDefault()
      event.stopPropagation()
      this.waveform.openClipContextMenu(event.clientX, event.clientY)
    })
    this.rectElement.addEventListener('mouseenter', (mouseEvent) => {
      this.trackListController.pointerStateManager.setPointedOverClipView(this)
    })
    this.rectElement.addEventListener('mouseleave', (mouseEvent) => {
      this.trackListController.pointerStateManager.removePointedOverClipView(this)
    })
    this.setDisplayMode(this.waveform.displayMode)
  }

  async moveThisClipView() {
    const newClipView = cloneClipViewWithNewStartPosition(this.clipView, this.draggedShift)
    const clipViewIndex = this.waveform.track.clipViews.indexOf(this.clipView)
    if (
      clipViewsEqual(this.clipView, newClipView) ||
      !this.waveform.track.canReplaceClipView(clipViewIndex, newClipView)
    ) {
      this.draggedShift = 0
      this.waveform.drawAudioData()
      return
    }
    await this.trackListController.history.execute(
      new ReplaceClipViewCommand(this.waveform.track, this.clipView, newClipView, 'move clip view'),
    )
  }

  get startPosition() {
    return this.clipView.startPosition + this.draggedShift
  }

  get endPosition() {
    return this.clipView.getEndPosition() + this.draggedShift
  }

  updateSpectrogramFallbackFill(): void {
    this.spectrogramFallbackElement.style.setProperty(
      '--spectrogram-fallback-color',
      this.waveform.spectrogramFallbackColor,
    )
  }

  setDisplayMode(mode: TrackDisplayMode): void {
    const spectrogramMode = mode === 'spectrogram'
    this.rectElement.classList.toggle('spectrogram-hit-rect', spectrogramMode)
  }

  getVideoPlacement(): VideoPlacement {
    if (this.fullClipPreview) {
      return {
        clip: this.clipView.clip,
        offset: 0,
        startPosition: this.startPosition - this.clipView.offset,
        length: this.clipView.clip.length,
      }
    }
    return {
      clip: this.clipView.clip,
      offset: this.clipView.offset,
      startPosition: this.startPosition,
      length: this.clipView.length,
    }
  }

  getSpectrogramPlacement(): SpectrogramClipPlacement {
    if (this.fullClipPreview) {
      return {
        clip: this.clipView.clip,
        timelineStart: this.clipView.startPosition - this.clipView.offset,
        sourceStart: 0,
        length: this.clipView.clip.length,
        startFadeLength: 0,
        endFadeLength: 0,
      }
    }
    return {
      clip: this.clipView.clip,
      timelineStart: this.startPosition,
      sourceStart: this.clipView.offset,
      length: this.clipView.length,
      startFadeLength: this.startCrossFadeDuration,
      endFadeLength: this.endCrossFadeDuration,
    }
  }

  switchParent(waveform: Waveform) {
    const oldWaveform = this.waveform
    oldWaveform.releaseClipViewController(this, true)
    oldWaveform.resetAfterDrawnOver(this.clipView)
    this.waveform = waveform
    waveform.adoptClipViewController(this)
    this.setDisplayMode(waveform.displayMode)
    this.reset()
    oldWaveform.draw()
    waveform.draw()
    this.draw(this.getSampleForXValue(0), this.getSampleForXValue(waveform.width))
  }

  private startClipViewMove(self: ClipViewController, startMouseEvent: MouseEvent) {
    this.trackListController.pointerStateManager.startMovingClipView(this, startMouseEvent)
  }

  drawBoundingBox(startSample: number, endSample: number) {
    const video = this.clipView.clip.videoSegments.length > 0
    this.headerTitleDivElement.innerText = `${video ? 'Video · ' : ''}${this.clipView.clip.name}`
    this.infoButton.setAttribute('aria-label', `View info for ${video ? 'video clip ' : ''}${this.clipView.clip.name}`)
    this.rectElement.y.baseVal.value = this.waveform.audioLaneTop
    this.spectrogramFallbackElement.y.baseVal.value = this.waveform.audioLaneTop
    this.spectrogramFallbackElement.style.display = this.clipView.clip.audioPresent ? '' : 'none'
    this.videoHitElement.y.baseVal.value = Waveform.HEADER_HEIGHT
    this.videoHitElement.height.baseVal.value = video ? this.waveform.videoLaneHeight : 0
    this.videoHitElement.style.display = video ? '' : 'none'
    this.rectElement.height.baseVal.value = this.waveformHeight
    this.leftHandle.y2.baseVal.value = this.waveform.transcriptionLaneTop
    this.rightHandle.y2.baseVal.value = this.waveform.transcriptionLaneTop
    this.fullClipGrayFilter.height.baseVal.value = this.waveformHeight + this.waveform.videoLaneHeight
    this.spectrogramFallbackElement.height.baseVal.value = this.waveformHeight
    this.updateSpectrogramFallbackFill()
    const spectrogramPlacement = this.getSpectrogramPlacement()
    const fallbackStartX = Math.max(this.getXValueForSample(spectrogramPlacement.timelineStart), -10000)
    const fallbackEndX = Math.min(
      this.getXValueForSample(spectrogramPlacement.timelineStart + spectrogramPlacement.length),
      10000,
    )
    this.spectrogramFallbackElement.x.baseVal.value = fallbackStartX
    this.spectrogramFallbackElement.width.baseVal.value = Math.max(0, fallbackEndX - fallbackStartX)
    // for some reason this breaks down when zooming in too much, so limit to +/-10000
    const xStart = Math.max(this.getXValueForSample(this.startPosition + this.startCrossFadeDuration), -10000)
    const startCrossFadeLength = this.startCrossFadeDuration / this.samplesPerUnit
    this.rectElement.x.baseVal.value = xStart
    this.headerElement.x.baseVal.value = xStart
    this.leftHandle.x1.baseVal.value = xStart - startCrossFadeLength
    this.leftHandle.x2.baseVal.value = xStart - startCrossFadeLength

    const xEnd = Math.min(this.getXValueForSample(this.endPosition - this.endCrossFadeDuration), 10000)
    const endCrossFadeLength = this.endCrossFadeDuration / this.samplesPerUnit
    this.rightHandle.x1.baseVal.value = xEnd + endCrossFadeLength
    this.rightHandle.x2.baseVal.value = xEnd + endCrossFadeLength

    this.rectElement.width.baseVal.value = Math.ceil(xEnd - xStart)
    const videoStartX = Math.max(this.getXValueForSample(this.startPosition), -10000)
    const videoEndX = Math.min(this.getXValueForSample(this.endPosition), 10000)
    this.videoHitElement.x.baseVal.value = videoStartX
    this.videoHitElement.width.baseVal.value = Math.max(0, videoEndX - videoStartX)
    const visibleStart = Math.max(0, xStart)
    const visibleEnd = Math.min(this.waveform.width, xEnd)
    this.noAudioLabel.setAttribute('x', `${(visibleStart + visibleEnd) / 2}`)
    this.noAudioLabel.setAttribute('y', `${this.waveform.audioLaneTop + this.waveformHeight / 2}`)
    this.noAudioLabel.style.display = !this.clipView.clip.audioPresent && visibleEnd - visibleStart > 64 ? '' : 'none'
    this.headerElement.width.baseVal.value = Math.ceil(xEnd - xStart)
    this.layoutHeader(xStart, Math.max(0, Math.ceil(xEnd - xStart)))
    this.endCrossFadeHeaderElement.x.baseVal.value = xEnd
    this.endCrossFadeHeaderElement.width.baseVal.value = Math.max(0, endCrossFadeLength)
    this.endCrossFadeHeaderTitleElement.x.baseVal.value = xEnd
    this.endCrossFadeHeaderTitleElement.width.baseVal.value = Math.max(0, endCrossFadeLength)
  }

  private layoutHeader(x: number, width: number) {
    this.headerTitleElement.x.baseVal.value = x
    this.headerTitleElement.width.baseVal.value = Math.max(0, width - Waveform.HEADER_HEIGHT)
    this.headerInfoElement.x.baseVal.value = x + this.headerTitleElement.clientWidth
    this.headerInfoElement.width.baseVal.value = Math.min(Waveform.HEADER_HEIGHT, width)
    const infoX = this.headerInfoElement.x.baseVal.value
    this.infoButton.tabIndex = infoX < 0 || infoX > this.waveform.width - Waveform.HEADER_HEIGHT ? -1 : 0
  }

  drawTranscriptionOverlay(viewportStartSample: number, viewportEndSample: number): void {
    const sourceStartSample = this.fullClipPreview ? 0 : this.clipView.offset
    const sourceEndSample = this.fullClipPreview
      ? this.clipView.clip.length
      : this.clipView.offset + this.clipView.length
    const timelineStartSample = this.fullClipPreview ? this.startPosition - this.clipView.offset : this.startPosition
    this.transcriptionOverlay.draw(
      sourceStartSample,
      sourceEndSample,
      timelineStartSample,
      viewportStartSample,
      viewportEndSample,
      this.waveform.width,
      this.waveform.transcriptionLaneTop,
      this.waveform.transcriptionLaneHeight,
    )
  }

  async draw(startSample: number, endSample: number) {
    this.drawBoundingBox(startSample, endSample)
    this.drawTranscriptionOverlay(startSample, endSample)
    this.waveform.requestVideoDraw()
    if (this.waveform.displayMode === 'waveform') {
      await this.drawWaveform(startSample, endSample)
    } else {
      this.waveform.requestSpectrogramDraw()
    }
  }

  async drawWaveform(startSample: number, endSample: number, fullClip = false) {
    if (!this.clipView.clip.audioPresent) {
      this.svgPathElement.setAttribute('d', '')
      this.startCrossFadePathElement.setAttribute('d', '')
      this.endCrossFadePathElement.setAttribute('d', '')
      return
    }
    let realStart, realEnd: number
    const clipViewStart = this.getXValueForSample(this.startPosition)
    const startSampleX = this.getXValueForSample(startSample)
    const crossFadeStartLastX = this.getXValueForSample(this.startCrossFadeDuration + this.startPosition)
    const crossFadeEndFirstX = this.getXValueForSample(this.endPosition - this.endCrossFadeDuration)

    realStart = Math.max(0, startSample - this.startPosition) + this.clipView.offset
    realEnd = Math.min(endSample - this.startPosition, this.clipView.length) + this.clipView.offset

    this.pathElementTranslation = Math.max(startSampleX, clipViewStart)

    if (fullClip) {
      let extendedShift = clipViewStart <= 0 ? 0 : Math.min(this.startPosition - startSample, this.clipView.offset)
      extendedShift = Math.floor(extendedShift / this.samplesPerUnit) * this.samplesPerUnit
      this.pathElementTranslation -= extendedShift / this.samplesPerUnit
      realStart -= extendedShift
      realEnd = Math.min(realStart + endSample - startSample, this.clipView.clip.length)
    }

    this.startCrossFadePathElement.setAttribute('transform', `translate(${this.pathElementTranslation}, 0)`)
    this.svgPathElement.setAttribute('transform', `translate(${this.pathElementTranslation}, 0)`)
    this.endCrossFadePathElement.setAttribute('transform', `translate(${this.pathElementTranslation}, 0)`)

    const summary = await SummaryGenerator.summarizeClipChannel(
      this.clipView.clip,
      realStart,
      realEnd,
      this.samplesPerUnit,
    )

    const channelCount = this.clipView.clip.getChannelCount()
    const channelHeight = this.waveformHeight / channelCount

    let fullPath = ''
    let startCrossFadePath = ''
    let endCrossFadePath = ''
    let mainPathStartX = -1
    let endCrossFadeStartX = -1
    for (let channel = 0; channel < channelCount; ++channel) {
      const xAxis = this.waveform.audioLaneTop + channel * channelHeight + channelHeight / 2
      const startCrossFadeSegments = new Array()
      const endCrossFadeSegments = new Array()
      const pathSegments = new Array(summary[channel].length)
      const xIncrement = this.samplesPerUnit > 2 ? 1 : 1 / this.samplesPerUnit
      for (let i = 0; i < summary[channel].length; i += 2) {
        let maximum = xAxis - (summary[channel][i] * channelHeight) / 2
        let minimum = xAxis - (summary[channel][i + 1] * channelHeight) / 2

        if (maximum - minimum < 1 && !(maximum > 0 && minimum < 0)) {
          if (maximum > 0) {
            --minimum
          } else {
            ++maximum
          }
        }
        const position = (i / 2) * xIncrement
        const pathSegment = `${this.samplesPerUnit > 2 ? 'L' : 'M'} ${position} ${maximum.toFixed(0)} L ${position} ${minimum.toFixed(0)}`
        if (position + this.pathElementTranslation < crossFadeStartLastX) {
          startCrossFadeSegments.push(pathSegment)
        } else if (position + this.pathElementTranslation > crossFadeEndFirstX) {
          if (endCrossFadeStartX == -1) {
            endCrossFadeStartX = position
          }
          endCrossFadeSegments.push(pathSegment)
        } else {
          if (mainPathStartX == -1) {
            mainPathStartX = position
          }
          pathSegments.push(pathSegment)
        }
      }
      startCrossFadePath += `M 0 ${xAxis} ` + startCrossFadeSegments.join(' ')
      fullPath += `M ${mainPathStartX} ${xAxis} ` + pathSegments.join(' ')
      endCrossFadePath += `M ${endCrossFadeStartX} ${xAxis} ` + endCrossFadeSegments.join(' ')
    }
    this.svgPathElement.setAttribute('d', fullPath)
    this.startCrossFadePathElement.setAttribute('d', startCrossFadePath)
    this.endCrossFadePathElement.setAttribute('d', endCrossFadePath)

    this.clipElementsGroup.classList.toggle('waveform-sample-detail', this.samplesPerUnit < 2)
  }

  reset() {
    this.fullClipPreview = false
    this.waveform.clipViewGroupElement.appendChild(this.clipElementsGroup)
    this.waveform.aboveClipViewGroupElement.appendChild(this.handleElementsGroup)

    this.rectElement.setAttribute('transform', '')
    this.headerElement.setAttribute('transform', '')
    this.headerTitleElement.setAttribute('transform', '')
    this.headerInfoElement.setAttribute('transform', '')
    this.endCrossFadeHeaderElement.setAttribute('transform', '')
    this.endCrossFadeHeaderTitleElement.setAttribute('transform', '')
    this.svgPathElement.setAttribute('transform', '')
    this.startCrossFadePathElement.setAttribute('transform', '')
    this.endCrossFadePathElement.setAttribute('transform', '')
    this.leftHandle.setAttribute('transform', '')
    this.rightHandle.setAttribute('transform', '')

    this.draw(this.getSampleForXValue(0), this.getSampleForXValue(this.waveform.width))
  }

  remove() {
    this.transcriptionOverlay.remove()
    this.clipElementsGroup.remove()
    this.handleElementsGroup.remove()
  }

  resize() {
    this.transcriptionOverlay.resize()
  }

  private get waveformHeight() {
    return this.waveform.getHeight()
  }

  drawMoveInProgressClipView(shift: number, activeWaveform: Waveform | null) {
    if (Math.abs(this.clipView.startPosition / this.samplesPerUnit + shift) < 5) {
      shift = -this.clipView.startPosition / this.samplesPerUnit
    }
    this.draggedShift = shift * this.samplesPerUnit
    activeWaveform?.drawClipViewOver(this)
  }

  updateClipViewResize(shift: number) {
    switch (this.resizeInfo?.side) {
      case 'left':
        const maxLeftShift = this.clipView.offset / this.samplesPerUnit
        const minLeftShift = this.clipView.length / this.samplesPerUnit
        shift = Math.max(Math.min(shift, minLeftShift + 1), -maxLeftShift)
        this.leftHandle.setAttribute('transform', `translate(${shift},0)`)

        this.fullClipGrayFilter.width.baseVal.value = maxLeftShift + shift
        this.headerElement.x.baseVal.value = this.resizeInfo.oldStartX + shift
        this.headerElement.width.baseVal.value = this.resizeInfo.oldWidth - shift
        this.rectElement.x.baseVal.value = this.resizeInfo.oldStartX + shift
        this.rectElement.width.baseVal.value = this.resizeInfo.oldWidth - shift
        this.videoHitElement.x.baseVal.value = this.resizeInfo.oldStartX + shift
        this.videoHitElement.width.baseVal.value = Math.max(0, this.resizeInfo.oldWidth - shift)

        this.layoutHeader(this.resizeInfo.oldStartX + shift, this.resizeInfo.oldWidth - shift)
        break
      case 'right':
        const maxRightShift =
          (this.clipView.clip.length - this.clipView.length - this.clipView.offset) / this.samplesPerUnit
        const minRightShift = -this.clipView.length / this.samplesPerUnit
        shift = Math.min(Math.max(shift, minRightShift - 1), maxRightShift)
        this.rightHandle.setAttribute('transform', `translate(${shift},0)`)

        this.fullClipGrayFilter.width.baseVal.value = maxRightShift - shift
        this.fullClipGrayFilter.x.baseVal.value = this.resizeInfo.oldStartX + this.resizeInfo.oldWidth + shift
        this.headerElement.width.baseVal.value = this.resizeInfo.oldWidth + shift
        this.rectElement.width.baseVal.value = this.resizeInfo.oldWidth + shift
        this.videoHitElement.width.baseVal.value = Math.max(0, this.resizeInfo.oldWidth + shift)
        this.layoutHeader(this.resizeInfo.oldStartX, this.resizeInfo.oldWidth + shift)
        break
    }
  }

  async finishClipViewResize(shift: number) {
    this.rightHandle.dataset.active = 'false'
    let newClipView: ClipView
    switch (this.resizeInfo!.side) {
      case 'left': {
        const maxLeftShift = this.clipView.offset / this.samplesPerUnit
        const minLeftShift = this.clipView.length / this.samplesPerUnit
        shift = Math.max(Math.min(shift, minLeftShift + 1), -maxLeftShift)
        const shiftSamples = Math.round(shift * this.samplesPerUnit)
        newClipView = new ClipView(
          this.clipView.clip,
          this.clipView.offset + shiftSamples,
          this.clipView.startPosition + shiftSamples,
          this.clipView.length - shiftSamples,
        )
        break
      }
      case 'right': {
        const maxRightShift =
          (this.clipView.clip.length - this.clipView.length - this.clipView.offset) / this.samplesPerUnit
        const minRightShift = -this.clipView.length / this.samplesPerUnit
        shift = Math.min(Math.max(shift, minRightShift - 1), maxRightShift)
        const shiftSamples = Math.round(shift * this.samplesPerUnit)
        newClipView = new ClipView(
          this.clipView.clip,
          this.clipView.offset,
          this.clipView.startPosition,
          this.clipView.length + shiftSamples,
        )
        break
      }
    }
    this.fullClipGrayFilter.width.baseVal.value = 0
    this.fullClipPreview = false
    this.resizeInfo = null
    this.waveform.requestSpectrogramDraw()
    this.waveform.requestVideoDraw()
    const clipViewIndex = this.waveform.track.clipViews.indexOf(this.clipView)
    if (
      clipViewsEqual(this.clipView, newClipView) ||
      !this.waveform.track.canReplaceClipView(clipViewIndex, newClipView)
    ) {
      this.reset()
      return
    }
    await this.trackListController.history.execute(
      new ReplaceClipViewCommand(this.waveform.track, this.clipView, newClipView, 'resize clip view'),
    )
  }

  private readonly leftHandleMouseDownListener = (event: MouseEvent) => {
    this.fullClipPreview = true
    const clipView = this.clipView
    const maxLeftShift = this.clipView.offset / this.samplesPerUnit
    const fullClipStartX = this.getXValueForSample(this.clipView.startPosition - this.clipView.offset)
    this.resizeInfo = {
      side: 'left',
      oldStartX: this.headerElement.x.baseVal.value,
      oldWidth: this.headerElement.width.baseVal.value,
      fullClipStartX: fullClipStartX,
      fullClipEndX: fullClipStartX + this.clipView.clip.length / this.samplesPerUnit,
    }

    this.fullClipGrayFilter.x.baseVal.value = this.getXValueForSample(clipView.startPosition - clipView.offset)
    this.fullClipGrayFilter.width.baseVal.value = maxLeftShift
    this.fullClipGrayFilter.y.baseVal.value = Waveform.HEADER_HEIGHT
    this.fullClipGrayFilter.height.baseVal.value = this.waveformHeight + this.waveform.videoLaneHeight

    this.drawTranscriptionOverlay(this.getSampleForXValue(0), this.getSampleForXValue(this.waveform.width))
    if (this.waveform.displayMode === 'waveform') {
      void this.drawWaveform(this.translation * this.samplesPerUnit, this.getSampleForXValue(this.waveform.width), true)
    } else {
      this.drawBoundingBox(this.translation * this.samplesPerUnit, this.getSampleForXValue(this.waveform.width))
      this.waveform.requestSpectrogramDraw()
    }
    this.waveform.requestVideoDraw()

    this.leftHandle.dataset.active = 'true'
    this.trackListController.pointerStateManager.startResizingClipView(this, event)
  }

  private readonly rightHandleMouseDownListener = (event: MouseEvent) => {
    this.fullClipPreview = true
    const clipView = this.clipView
    const maxRightShift = (clipView.clip.length - clipView.length - clipView.offset) / this.samplesPerUnit
    const filterStartX = this.getXValueForSample(clipView.getEndPosition())
    const fullClipStartX = this.getXValueForSample(this.clipView.startPosition - this.clipView.offset)
    this.resizeInfo = {
      side: 'right',
      oldStartX: this.headerElement.x.baseVal.value,
      oldWidth: this.headerElement.width.baseVal.value,
      fullClipStartX: fullClipStartX,
      fullClipEndX: fullClipStartX + this.clipView.clip.length / this.samplesPerUnit,
    }
    this.drawTranscriptionOverlay(this.getSampleForXValue(0), this.getSampleForXValue(this.waveform.width))

    if (this.waveform.displayMode === 'waveform') {
      void this.drawWaveform(this.translation * this.samplesPerUnit, this.getSampleForXValue(this.waveform.width), true)
    } else {
      this.drawBoundingBox(this.translation * this.samplesPerUnit, this.getSampleForXValue(this.waveform.width))
      this.waveform.requestSpectrogramDraw()
    }
    this.waveform.requestVideoDraw()

    this.fullClipGrayFilter.x.baseVal.value = filterStartX
    this.fullClipGrayFilter.width.baseVal.value = maxRightShift
    this.fullClipGrayFilter.y.baseVal.value = Waveform.HEADER_HEIGHT
    this.fullClipGrayFilter.height.baseVal.value = this.waveformHeight + this.waveform.videoLaneHeight

    this.rightHandle.dataset.active = 'true'
    this.trackListController.pointerStateManager.startResizingClipView(this, event)
  }
}
