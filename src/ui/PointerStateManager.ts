import { AudioControl, AudioState } from '../audiocontext/AudioControl'
import { KeyPressController } from './KeyPressController'
import { TimelineRegionController } from './timeline/TimelineRegionController'
import { TrackListController } from './timeline/TrackListController'
import { TrackListItemController } from './timeline/TrackListItemController'
import { ClipViewController, Waveform } from './timeline/Waveform'

export class PointerStateManager extends TrackListItemController {
  private state = State.DEFAULT

  public activeClipViewController: ClipViewController | null = null
  public activeWaveform: Waveform | null = null
  private mouseDownPoint: { x: number; y: number } | null = null
  private clipViewMoveInfo: { clipViewController: ClipViewController } | null = null
  private timelineRegionController: TimelineRegionController | null = null

  private readonly timelineAreaElement = document.getElementById('timeline-area')!

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
          if (mouseEvent.buttons == 1 && mouseEvent.button == 0) {
            this.markPointerDown(mouseEvent)
          }
          break
        case State.SELECTING:
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
        case State.MOVING_CLIPVIEW: {
          this.activeWaveform?.drawClipViewOver(this.clipViewMoveInfo!.clipViewController)
          const shift = mouseEvent.clientX - this.mouseDownPoint!.x
          this.clipViewMoveInfo!.clipViewController.drawMoveInProgressClipView(shift)
          break
        }
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
          this.changeState(State.DEFAULT)
          this.timelineRegionController!.updateListener()
          break
        case State.MOVING_CLIPVIEW: {
          const droppedOnNewTrack = this.trackListController.isPointInNewTrackDropRegion(
            mouseEvent.clientX,
            mouseEvent.clientY,
          )
          this.changeState(State.DEFAULT)
          let xShift = mouseEvent.clientX - this.mouseDownPoint!.x
          if (Math.abs(xShift + this.clipViewMoveInfo!.clipViewController.rectElement.x.baseVal.value) < 5) {
            xShift = -this.clipViewMoveInfo!.clipViewController.rectElement.x.baseVal.value
          }
          const shift = Math.round(xShift * this.samplesPerUnit)
          if (droppedOnNewTrack) {
            await this.trackListController.transferClipViewToNewTrack(this.clipViewMoveInfo!.clipViewController, shift)
          } else if (
            !this.activeWaveform ||
            this.clipViewMoveInfo!.clipViewController.waveform == this.activeWaveform
          ) {
            await this.clipViewMoveInfo!.clipViewController.moveThisClipView(shift)
          } else {
            await this.trackListController.transferClipViewBetweenTracks(
              this.clipViewMoveInfo!.clipViewController,
              this.activeWaveform,
              shift,
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
    }

    const scrollListener = (event: WheelEvent) => {
      if (event.ctrlKey) {
        ;(trackListController as any).zoom(event)
        event.preventDefault()
        event.stopPropagation()
      } else if (event.deltaX) {
        ;(trackListController as any).translate(event.deltaX)
        event.preventDefault()
        event.stopPropagation()
      }
    }

    this.timelineAreaElement.addEventListener('wheel', scrollListener, { passive: false })
    document.getElementById('timeline')!.addEventListener('wheel', scrollListener, { passive: false })

    timelineAreaElement.addEventListener('mousedown', mouseDownListener)
    timelineAreaElement.addEventListener('mousemove', mouseMoveListener)

    timelineElement.addEventListener('mousedown', mouseDownListener)
    timelineElement.addEventListener('mousemove', mouseMoveListener)

    document.addEventListener('mouseup', mouseUpListener)
  }

  startResizingSelection(timelineRegionController: TimelineRegionController) {
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

  startMovingClipView(controller: ClipViewController, mouseDownX: number) {
    if (!this.changeState(State.MOVING_CLIPVIEW)) {
      return
    }
    this.clipViewMoveInfo = { clipViewController: controller }
    this.mouseDownPoint = { x: mouseDownX, y: 0 }
    this.trackListController.showNewTrackDropRegion(controller.clipView.clip.getChannelCount())
  }

  startSelecting() {
    this.trackListController.positionMarkerController.hidePositionMarker()
    this.changeState(State.SELECTING)
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
    AudioControl.startPosition = Math.round(this.sampleForMouseEvent(mouseEvent))
    this.trackListController.positionMarkerController.draw()
    this.trackListController.clearSelection()
    this.timelineRegionController = null
    this.timelineAreaElement.style.cursor = 'col-resize'
  }

  reset() {
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
    if (this.state == newState) {
      return
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
