import { AudioControl, AudioState } from '../audiocontext/AudioControl'
import { KeyPressController } from './KeyPressController'
import { TimelineRegionController } from './timeline/TimelineRegionController'
import { TrackListController } from './timeline/TrackListController'
import { TrackListItemController } from './timeline/TrackListItemController'
import { ClipViewController, Waveform } from './timeline/Waveform'
import type { TrackTranscriptEntry } from './transcript/TrackTranscript'

export class PointerStateManager extends TrackListItemController {
  private state = State.DEFAULT

  public activeClipViewController: ClipViewController | null = null
  public activeWaveform: Waveform | null = null
  private mouseDownPoint: { x: number; y: number } | null = null
  private clipViewMoveInfo: { clipViewController: ClipViewController; startWave: Waveform } | null = null
  private clipDragPoint: { x: number; y: number } | null = null
  private clipDragScrollFrame: number | null = null
  private clipDragScrollTime = 0
  private timelineRegionController: TimelineRegionController | null = null
  private selectingTranscript = false
  private pendingTranscript: {
    waveform: Waveform
    entry: TrackTranscriptEntry
    clientX: number
    clientY: number
    cancelled: boolean
  } | null = null

  private readonly timelineAreaElement = document.getElementById('timeline-area')!
  private readonly trackScrollElement = document.getElementById('input-track-lists')!

  constructor(trackListController: TrackListController) {
    super(trackListController)
    const timelineAreaElement = document.getElementById('timeline-area')!
    const timelineElement = document.getElementById('timeline')!
    AudioControl.addAudioControlListener((state) => {
      switch (state) {
        case AudioState.PLAYING:
        case AudioState.RECORDING:
        case AudioState.PLAYING_PAUSED:
        case AudioState.RECORDING_PAUSED:
          this.changeState(State.READ_ONLY)
          break
        case AudioState.MONITORING:
        case AudioState.MONITORING_PAUSED:
        case AudioState.STOPPED:
          this.changeState(State.DEFAULT)
          break
      }
    })

    document.addEventListener(
      'mousedown',
      () => {
        this.pendingTranscript = null
        this.finishSelectingTranscript()
      },
      true,
    )
    window.addEventListener('blur', () => {
      this.pendingTranscript = null
      this.finishSelectingTranscript()
      this.cancelMovingClipView()
    })
    timelineAreaElement.addEventListener(
      'mousedown',
      (event) => {
        if (
          event.button !== 0 ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          (this.state !== State.DEFAULT && this.state !== State.SELECTING && this.state !== State.READ_ONLY) ||
          Math.abs(event.clientX - this.trackListController.positionMarkerController.x) < 2 ||
          !(event.target instanceof Element) ||
          event.target instanceof SVGLineElement
        )
          return
        const div = event.target.closest('.waveform')
        const waveform = this.trackListController.waveforms.find((w) => w.div === div)
        const entry = waveform?.hitTestTranscript(event)
        if (waveform && entry) {
          this.pendingTranscript = {
            waveform,
            entry,
            clientX: event.clientX,
            clientY: event.clientY,
            cancelled: false,
          }
        }
      },
      true,
    )
    document.addEventListener('mousemove', (event) => {
      const pending = this.pendingTranscript
      if (
        pending &&
        (Math.abs(event.clientX - pending.clientX) >= 2 || Math.abs(event.clientY - pending.clientY) >= 2)
      ) {
        pending.cancelled = true
      }
      if (this.state === State.MOVING_CLIPVIEW) {
        this.clipDragPoint!.x = event.clientX
        this.clipDragPoint!.y = event.clientY
        this.updateMovingClipView()
      }
    })
    const outputLaneFor = (target: EventTarget | null) =>
      target instanceof Element ? target.closest<HTMLElement>('.timeline-output-lane') : null

    const mouseMoveListener = async (mouseEvent: MouseEvent) => {
      if (Math.abs(mouseEvent.x - this.trackListController.positionMarkerController.x) < 2) {
        this.timelineAreaElement.style.cursor = 'col-resize'
      } else if (this.state !== State.MARKING) {
        this.timelineAreaElement.style.cursor = 'crosshair'
      }
      switch (this.state) {
        case State.DEFAULT:
          break
        case State.MARKING:
          if (mouseEvent.buttons == 1) {
            this.markPointerDown(mouseEvent)
          }
          break
        case State.SELECTING:
          if (this.selectingTranscript) break
          if (
            mouseEvent.buttons == 1 &&
            mouseEvent.button == 0 &&
            Math.abs(mouseEvent.clientX - this.mouseDownPoint!.x) >= 2
          ) {
            trackListController.positionMarkerController.hidePositionMarker()
            if (!this.timelineRegionController) {
              this.timelineRegionController = this.trackListController.selectionController
            }
            this.timelineRegionController.updateSelection(
              this.sampleForMouseEvent(mouseEvent),
              this.activeWaveform,
              true,
            )
          }
          break
        case State.MOVING_CLIPVIEW:
          break
        case State.RESIZING_CLIPVIEW: {
          const shift = mouseEvent.clientX - this.mouseDownPoint!.x
          this.activeClipViewController!.updateClipViewResize(shift)
          mouseEvent.stopPropagation()
          break
        }
        case State.AUTOMATING:
        case State.READ_ONLY:
          break
      }
    }
    const mouseDownListener = async (mouseEvent: MouseEvent) => {
      if (outputLaneFor(mouseEvent.target)) return
      if (Math.abs(mouseEvent.x - this.trackListController.positionMarkerController.x) < 2) {
        this.startMovingMark()
        return
      }
      this.mouseDownPoint = { x: mouseEvent.clientX, y: mouseEvent.clientY }
      if (mouseEvent.buttons == 1 && mouseEvent.button == 0) {
        if (KeyPressController.metaPressed) {
          this.timelineRegionController = this.trackListController.selectionController
          this.timelineRegionController.updateSelection(
            this.getSampleForXValue(this.mouseEventToSvgCoord(mouseEvent).x),
            this.activeWaveform,
            false,
          )
          this.changeState(State.SELECTING)
        } else {
          trackListController.clearSelection()
          this.timelineRegionController = null
        }
      }
      switch (this.state) {
        case State.DEFAULT:
          if (mouseEvent.buttons == 1 && mouseEvent.button == 0) {
            if (
              AudioControl.getState() == AudioState.STOPPED ||
              AudioControl.getState() == AudioState.MONITORING ||
              AudioControl.getState() == AudioState.MONITORING_PAUSED
            ) {
              this.markPointerDown(mouseEvent)
              this.timelineRegionController = this.trackListController.selectionController
              this.timelineRegionController.updateSelection(
                this.sampleForMouseEvent(mouseEvent),
                this.activeWaveform,
                false,
              )
              this.changeState(State.SELECTING)
            }
          }
          break
        case State.MARKING:
          if (mouseEvent.buttons == 1 && mouseEvent.button == 0) {
            this.markPointerDown(mouseEvent)
          }
          break
        case State.SELECTING:
        case State.MOVING_CLIPVIEW:
        case State.RESIZING_CLIPVIEW:
        case State.AUTOMATING:
        case State.READ_ONLY:
          break
      }
    }
    const mouseUpListener = async (mouseEvent: MouseEvent) => {
      switch (this.state) {
        case State.DEFAULT:
          break
        case State.MARKING:
          this.changeState(State.DEFAULT)
          break
        case State.SELECTING:
          if (this.selectingTranscript) {
            this.finishSelectingTranscript()
          } else this.changeState(State.DEFAULT)
          break
        case State.MOVING_CLIPVIEW: {
          this.clipDragPoint!.x = mouseEvent.clientX
          this.clipDragPoint!.y = mouseEvent.clientY
          this.drawMovingClipView()
          const droppedOnNewTrack =
            this.trackScrollElement.contains(document.elementFromPoint(mouseEvent.clientX, mouseEvent.clientY)) &&
            this.trackListController.isPointInNewTrackDropRegion(mouseEvent.clientX, mouseEvent.clientY)
          this.changeState(State.DEFAULT)
          const moveInfo = this.clipViewMoveInfo!
          if (droppedOnNewTrack) {
            if (moveInfo.clipViewController.waveform != moveInfo.startWave) {
              moveInfo.clipViewController.switchParent(moveInfo.startWave)
            }
            await this.trackListController.transferClipViewToNewTrack(
              moveInfo.clipViewController.waveform.track,
              moveInfo.clipViewController.clipView,
              moveInfo.clipViewController.draggedShift,
            )
          } else if (moveInfo.startWave == this.activeWaveform) {
            if (moveInfo.clipViewController.waveform != moveInfo.startWave) {
              moveInfo.clipViewController.switchParent(moveInfo.startWave)
            }
            await moveInfo.clipViewController.moveThisClipView()
          } else {
            await this.trackListController.transferClipViewBetweenTracks(
              moveInfo.clipViewController,
              moveInfo.startWave,
            )
          }
          break
        }
        case State.RESIZING_CLIPVIEW: {
          const shift = mouseEvent.clientX - this.mouseDownPoint!.x
          await this.activeClipViewController!.finishClipViewResize(shift)
          this.changeState(State.DEFAULT)
          break
        }
        case State.AUTOMATING:
        case State.READ_ONLY:
          break
      }
      const pending = this.pendingTranscript
      this.pendingTranscript = null
      if (
        pending &&
        !pending.cancelled &&
        mouseEvent.button === 0 &&
        mouseEvent.target instanceof Element &&
        mouseEvent.target.closest('.waveform') === pending.waveform.div &&
        this.trackListController.waveforms.includes(pending.waveform)
      ) {
        const entry = pending.waveform.hitTestTranscript(mouseEvent)
        if (
          entry &&
          entry.clipView === pending.entry.clipView &&
          entry.placementIndex === pending.entry.placementIndex &&
          entry.rangeIndex === pending.entry.rangeIndex &&
          entry.startSample === pending.entry.startSample &&
          entry.endSample === pending.entry.endSample
        ) {
          this.trackListController.openTrackTranscript(pending.waveform.track, entry)
        }
      }
    }

    const scrollListener = (event: WheelEvent) => {
      if (event.ctrlKey) {
        trackListController.zoomWithWheel(event)
        event.preventDefault()
        event.stopPropagation()
      } else if (event.deltaX) {
        trackListController.translate(event.deltaX)
        event.preventDefault()
        event.stopPropagation()
      }
    }

    this.timelineAreaElement.addEventListener('wheel', scrollListener, { passive: false })
    document.getElementById('timeline')!.addEventListener('wheel', scrollListener, { passive: false })

    timelineAreaElement.addEventListener('mousedown', mouseDownListener)
    timelineAreaElement.addEventListener('mousemove', (event) => {
      if (!outputLaneFor(event.target)) void mouseMoveListener(event)
    })
    timelineAreaElement.addEventListener('pointerdown', (event) => {
      const lane = outputLaneFor(event.target)
      if (!lane || !event.isPrimary || event.button !== 0 || !trackListController.canEdit()) return
      event.preventDefault()
      lane.setPointerCapture(event.pointerId)
      this.activeWaveform = null
      this.activeClipViewController = null
      this.markPointerDown(event)
      this.startMovingMark()
    })
    timelineAreaElement.addEventListener('pointermove', (event) => {
      if (event.isPrimary && outputLaneFor(event.target)) void mouseMoveListener(event)
    })
    for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      timelineAreaElement.addEventListener(eventName, (event) => {
        if (event.isPrimary && outputLaneFor(event.target) && this.state === State.MARKING) {
          this.changeState(State.DEFAULT)
        }
      })
    }

    timelineElement.addEventListener('mousedown', mouseDownListener)
    timelineElement.addEventListener('mousemove', mouseMoveListener)

    document.addEventListener('mouseup', mouseUpListener)
  }

  startSelectingTranscript(event: MouseEvent): void {
    if (this.state !== State.DEFAULT && this.state !== State.SELECTING) return
    this.pendingTranscript = null
    this.mouseDownPoint = { x: event.clientX, y: event.clientY }
    this.activeClipViewController = null
    this.activeWaveform = null
    this.timelineRegionController = this.trackListController.selectionController
    this.selectingTranscript = true
    this.changeState(State.SELECTING)
  }

  finishSelectingTranscript(): void {
    if (this.selectingTranscript) {
      this.changeState(State.DEFAULT)
    }
  }

  startResizingSelection(timelineRegionController: TimelineRegionController, event: MouseEvent): void {
    this.pendingTranscript = null
    this.mouseDownPoint = { x: event.clientX, y: event.clientY }
    this.activeClipViewController = null
    this.activeWaveform = null
    this.timelineRegionController = timelineRegionController
    this.changeState(State.SELECTING)
  }

  startMovingMark() {
    if (this.state == State.AUTOMATING) {
      return
    }
    this.changeState(State.MARKING)
  }

  startResizingClipView(controller: ClipViewController) {
    if (!this.changeState(State.RESIZING_CLIPVIEW)) {
      return
    }
    this.activeClipViewController = controller
  }

  startMovingClipView(controller: ClipViewController, event: MouseEvent) {
    if (!this.changeState(State.MOVING_CLIPVIEW)) {
      return
    }
    this.clipViewMoveInfo = { clipViewController: controller, startWave: controller.waveform }
    this.mouseDownPoint = { x: event.clientX, y: event.clientY }
    this.clipDragPoint = { x: event.clientX, y: event.clientY }
    this.trackListController.showNewTrackDropRegion(controller.clipView.clip.getChannelCount())
    this.updateMovingClipView()
  }

  private drawMovingClipView() {
    const point = this.clipDragPoint!
    // Scrolling changes the track under a stationary pointer without a mousemove.
    const div = document.elementFromPoint(point.x, point.y)?.closest('.waveform')
    this.activeWaveform = this.trackListController.waveforms.find((waveform) => waveform.div === div) ?? null
    this.clipViewMoveInfo!.clipViewController.drawMoveInProgressClipView(
      point.x - this.mouseDownPoint!.x,
      this.activeWaveform,
    )
  }

  private updateMovingClipView() {
    this.drawMovingClipView()
    if (this.clipDragScrollSpeed() === 0) {
      this.stopClipDragAutoscroll()
    } else if (this.clipDragScrollFrame === null) {
      this.clipDragScrollTime = performance.now()
      this.clipDragScrollFrame = requestAnimationFrame(this.scrollMovingClipView)
    }
  }

  private clipDragScrollSpeed(): number {
    const point = this.clipDragPoint
    if (!point) return 0
    const bounds = this.trackScrollElement.getBoundingClientRect()
    const top = Math.max(0, bounds.top)
    const bottom = Math.min(window.innerHeight, bounds.bottom)
    if (bottom <= top || point.x < bounds.left || point.x > bounds.right) return 0
    const edge = Math.min(48, (bottom - top) / 2)
    if (point.y < top + edge && this.trackScrollElement.scrollTop > 0) {
      return -(80 + 520 * Math.min(1, (top + edge - point.y) / edge))
    }
    if (
      point.y > bottom - edge &&
      this.trackScrollElement.scrollTop + this.trackScrollElement.clientHeight < this.trackScrollElement.scrollHeight
    ) {
      return 80 + 520 * Math.min(1, (point.y - bottom + edge) / edge)
    }
    return 0
  }

  private readonly scrollMovingClipView = (time: number) => {
    this.clipDragScrollFrame = null
    const speed = this.clipDragScrollSpeed()
    if (speed === 0) return
    const elapsed = Math.max(0, Math.min(time - this.clipDragScrollTime, 50)) / 1000
    this.clipDragScrollTime = time
    const previousScrollTop = this.trackScrollElement.scrollTop
    this.trackScrollElement.scrollTop += speed * elapsed
    if (this.trackScrollElement.scrollTop !== previousScrollTop) {
      this.drawMovingClipView()
    }
    this.clipDragScrollFrame = requestAnimationFrame(this.scrollMovingClipView)
  }

  private stopClipDragAutoscroll() {
    if (this.clipDragScrollFrame !== null) {
      cancelAnimationFrame(this.clipDragScrollFrame)
      this.clipDragScrollFrame = null
    }
  }

  private cancelMovingClipView() {
    if (this.state !== State.MOVING_CLIPVIEW) return
    const { clipViewController, startWave } = this.clipViewMoveInfo!
    this.changeState(State.DEFAULT)
    clipViewController.draggedShift = 0
    if (clipViewController.waveform !== startWave) {
      clipViewController.switchParent(startWave)
    } else {
      startWave.draw()
    }
  }

  startAutomating() {
    this.changeState(State.AUTOMATING)
  }

  stopAutomating() {
    if (this.state == State.AUTOMATING) {
      this.changeState(State.DEFAULT)
    }
  }

  isAutomating() {
    return this.state == State.AUTOMATING
  }

  setPointedOverClipView(controller: ClipViewController) {
    if (this.state == State.MOVING_CLIPVIEW || this.state == State.RESIZING_CLIPVIEW) {
      return
    }
    this.activeClipViewController = controller
  }

  removePointedOverClipView(controller: ClipViewController) {
    if (
      this.activeClipViewController != controller ||
      this.state == State.MOVING_CLIPVIEW ||
      this.state == State.RESIZING_CLIPVIEW
    ) {
      return
    }
    this.activeClipViewController = null
  }

  setPointedOverTrack(waveform: Waveform) {
    this.activeWaveform = waveform
  }

  removePointedOverTrack(waveform: Waveform) {
    if (this.activeWaveform == waveform) {
      this.activeWaveform = null
    }
  }

  resize(): void {
    // not displayed
  }

  getActiveTrack(): Waveform | null {
    return this.activeWaveform
  }

  private markPointerDown(mouseEvent: MouseEvent) {
    AudioControl.startPosition = Math.max(0, Math.round(this.sampleForMouseEvent(mouseEvent)))
    this.trackListController.positionMarkerController.draw()
    this.trackListController.clearSelection()
    this.timelineRegionController = null
    this.timelineAreaElement.style.cursor = 'col-resize'
    this.trackListController.timelineKeyboard.refresh()
  }

  reset() {
    this.pendingTranscript = null
    this.changeState(State.DEFAULT)
    this.activeClipViewController = null
    this.activeWaveform = null
    this.clipViewMoveInfo = null
    this.mouseDownPoint = null
    this.timelineRegionController = null
  }

  private sampleForMouseEvent(mouseEvent: MouseEvent) {
    return this.getSampleForXValue(this.mouseEventToSvgCoord(mouseEvent).x)
  }

  private changeState(newState: State) {
    if (
      newState === State.MARKING ||
      newState === State.MOVING_CLIPVIEW ||
      newState === State.RESIZING_CLIPVIEW ||
      newState === State.AUTOMATING
    )
      this.pendingTranscript = null
    if (this.state == newState) {
      return
    }
    if (this.selectingTranscript && newState !== State.SELECTING) {
      this.selectingTranscript = false
      this.mouseDownPoint = null
      this.timelineRegionController = null
    }
    switch (this.state) {
      case State.SELECTING:
        if (newState != State.DEFAULT && newState != State.READ_ONLY) {
          this.trackListController.clearSelection()
          this.timelineRegionController = null
          this.trackListController.positionMarkerController.hidePositionMarker()
        }
        break
      case State.DEFAULT:
        break
      case State.MOVING_CLIPVIEW:
      case State.RESIZING_CLIPVIEW:
      case State.AUTOMATING:
        if (newState != State.DEFAULT && newState != State.SELECTING && newState != State.READ_ONLY) {
          return false
        }
        break
    }
    if (this.state == State.MOVING_CLIPVIEW && newState != State.MOVING_CLIPVIEW) {
      this.stopClipDragAutoscroll()
      this.clipDragPoint = null
      this.trackListController.hideNewTrackDropRegion()
    }
    this.state = newState
    return true
  }
}

enum State {
  DEFAULT,
  MARKING,
  SELECTING,
  MOVING_CLIPVIEW,
  RESIZING_CLIPVIEW,
  AUTOMATING,
  READ_ONLY,
}
