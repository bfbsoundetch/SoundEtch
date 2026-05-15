import { AudioControl, AudioState } from '../audiocontext/AudioControl'
import { TimeUtils } from '../global/TimeUtils'
import { KeyPressController } from './KeyPressController'
import { TrackListController } from './timeline/TrackListController'
import { TrackListItemController } from './timeline/TrackListItemController'
import { ClipViewController, Waveform } from './timeline/Waveform'

export class PointerStateManager extends TrackListItemController {
  private state = State.DEFAULT

  private activeClipViewController: ClipViewController | null = null
  private activeWaveform: Waveform | null = null
  private mouseDownPoint: { x: number; y: number } | null = null
  private clipViewMoveInfo: { clipViewController: ClipViewController } | null = null

  constructor(trackListController: TrackListController) {
    super(trackListController)
    const listsElement = document.getElementById('input-track-lists')!
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
        case AudioState.STOPPED:
          this.changeState(State.DEFAULT)
          break
      }
    })

    const mouseMoveListener = async (mouseEvent: MouseEvent) => {
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
            trackListController.updateSelection(
              this.getSampleForXValue(this.mouseEventToSvgCoord(mouseEvent).x),
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
      this.mouseDownPoint = { x: mouseEvent.clientX, y: mouseEvent.clientY }
      switch (this.state) {
        case State.DEFAULT:
          if (mouseEvent.buttons == 1 && mouseEvent.button == 0) {
            if (AudioControl.getState() == AudioState.STOPPED || AudioControl.getState() == AudioState.MONITORING) {
              this.markPointerDown(mouseEvent)
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
          if (mouseEvent.buttons == 1 && mouseEvent.button == 0) {
            if (KeyPressController.metaPressed) {
              trackListController.updateSelection(
                this.getSampleForXValue(this.mouseEventToSvgCoord(mouseEvent).x),
                this.activeWaveform,
                false,
              )
            } else {
              trackListController.clearSelection()
              this.changeState(State.DEFAULT)
            }
          }
          break
        case State.MOVING_CLIPVIEW:
          break
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
          break
        case State.MOVING_CLIPVIEW:
          this.changeState(State.DEFAULT)
          let xShift = mouseEvent.clientX - this.mouseDownPoint!.x
          if (Math.abs(xShift + this.clipViewMoveInfo!.clipViewController.rectElement.x.baseVal.value) < 5) {
            xShift = -this.clipViewMoveInfo!.clipViewController.rectElement.x.baseVal.value
          }
          const shift = Math.round(xShift * this.samplesPerUnit)
          if (!this.activeWaveform || this.clipViewMoveInfo!.clipViewController.waveform == this.activeWaveform) {
            await this.clipViewMoveInfo!.clipViewController.moveThisClipView(shift)
          } else {
            await this.trackListController.transferClipViewBetweenTracks(
              this.clipViewMoveInfo!.clipViewController,
              this.activeWaveform!,
              shift,
            )
          }
          break
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

    listsElement.addEventListener('mousedown', mouseDownListener)
    listsElement.addEventListener('mouseup', mouseUpListener)
    listsElement.addEventListener('mousemove', mouseMoveListener)

    timelineElement.addEventListener('mousedown', mouseDownListener)
    timelineElement.addEventListener('mouseup', mouseUpListener)
    timelineElement.addEventListener('mousemove', mouseMoveListener)
  }

  startResizingSelection(leftExpand: boolean) {
    this.activeClipViewController = null
    this.activeWaveform = null
    this.trackListController.updateSelectionStartSample(leftExpand)
    this.changeState(State.SELECTING)
  }

  startMovingMark() {
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
    AudioControl.startPosition = Math.round(this.getSampleForXValue(this.mouseEventToSvgCoord(mouseEvent).x))
    this.trackListController.positionMarkerController.draw()
    this.trackListController.clearSelection()
  }

  private changeState(newState: State) {
    if (this.state == newState) {
      return
    }
    switch (this.state) {
      case State.SELECTING:
        if (newState != State.DEFAULT && newState != State.READ_ONLY) {
          this.trackListController.clearSelection()
          this.trackListController.positionMarkerController.hidePositionMarker()
        }
        break
      case State.DEFAULT:
        break
      case State.MOVING_CLIPVIEW:
      case State.RESIZING_CLIPVIEW:
      case State.AUTOMATING:
        if (newState == State.MOVING_CLIPVIEW) {
          return false
        }
        break
    }
    console.error('nustate', newState)
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
