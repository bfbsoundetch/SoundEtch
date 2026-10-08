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
      if (pending && (Math.abs(event.clientX - pending.clientX) >= 2 || Math.abs(event.clientY - pending.clientY) >= 2)) {
        pending.cancelled = true
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
        case State.MOVING_CLIPVIEW: {
          const shift = mouseEvent.clientX - this.mouseDownPoint!.x
          this.clipViewMoveInfo!.clipViewController.drawMoveInProgressClipView(shift, this.activeWaveform)
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
          if (this.selectingTranscript) this.finishSelectingTranscript()
          else this.changeState(State.DEFAULT)
          break
        case State.MOVING_CLIPVIEW: {
          const droppedOnNewTrack = this.trackListController.isPointInNewTrackDropRegion(
            mouseEvent.clientX,
            mouseEvent.clientY,
          )
          this.changeState(State.DEFAULT)
          const moveInfo = this.clipViewMoveInfo!
          if (droppedOnNewTrack) {
            if (moveInfo.clipViewController.waveform != moveInfo.startWave) {
              moveInfo.clipViewController.switchParent(moveInfo.startWave)
            }
            await this.trackListController.transferClipViewToNewTrack(moveInfo.clipViewController)
          } else if (!this.activeWaveform) {
            if (moveInfo.clipViewController.waveform != moveInfo.startWave) {
              moveInfo.clipViewController.switchParent(moveInfo.startWave)
            }
            await moveInfo.clipViewController.moveThisClipView()
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
    if (this.selectingTranscript) this.changeState(State.DEFAULT)
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

  startMovingClipView(controller: ClipViewController, mouseDownX: number) {
    if (!this.changeState(State.MOVING_CLIPVIEW)) {
      return
    }
    this.clipViewMoveInfo = { clipViewController: controller, startWave: controller.waveform }
    this.mouseDownPoint = { x: mouseDownX, y: 0 }
    this.trackListController.showNewTrackDropRegion(controller.clipView.clip.getChannelCount())
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
