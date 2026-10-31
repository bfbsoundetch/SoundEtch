import { TimeUtils } from '../../global/TimeUtils'
import { AudioState, AudioControl } from '../../audiocontext/AudioControl'
import { TrackListController } from './TrackListController'
import { TrackListItemController } from './TrackListItemController'

export class PositionMarkerController extends TrackListItemController {
  readonly positionMarkerSvg = document.getElementById('position-marker') as unknown as SVGSVGElement
  private readonly positionLineSvg = document.getElementById('position-line') as unknown as SVGLineElement
  private readonly positionTimeText = document.getElementById('pointer-position-text') as unknown as SVGTextElement

  public x = 0

  constructor(trackListController: TrackListController) {
    super(trackListController)
    this.positionLineSvg.addEventListener(
      'mousedown',
      (event) => {
        if (event.buttons == 1 && event.button == 0) {
          this.trackListController.pointerStateManager.startMovingMark()
          event.preventDefault()
        }
      },
      { passive: false },
    )

    this.resize()
  }

  resize() {
    const height = document.body.clientHeight - this.positionMarkerSvg.getBoundingClientRect().y
    this.positionMarkerSvg.setAttribute('height', `${height}`)
    this.positionLineSvg.setAttribute('y2', `${height}`)
    this.positionMarkerSvg.setAttribute('viewBox', `0 0 ${this.positionLineSvg.parentElement!.clientWidth} ${height}`)
  }

  hidePositionMarker() {
    AudioControl.startPosition = 0
    this.x = -100
    this.positionLineSvg.x1.baseVal.value = -100
    this.positionLineSvg.x2.baseVal.value = -100
    this.positionTimeText.setAttribute('x', '-100')
  }

  draw(positionOverride: number | null = null) {
    let position
    if (
      AudioControl.getState() == AudioState.STOPPED ||
      AudioControl.getState() == AudioState.MONITORING ||
      AudioControl.getState() == AudioState.MONITORING_PAUSED
    ) {
      if (AudioControl.startPosition == 0) {
        this.hidePositionMarker()
        this.trackListController.outputTimelineController?.draw(0)
        return
      }
      position = AudioControl.startPosition
      this.positionLineSvg.classList = 'blink'
      this.positionTimeText.dataset.audioState = AudioState.STOPPED
    } else {
      position = AudioControl.audioContext!.getPosition()
      this.positionLineSvg.classList = ''
      switch (AudioControl.getState()) {
        case AudioState.PLAYING:
          this.positionTimeText.dataset.audioState = AudioState.PLAYING
          break
        case AudioState.RECORDING:
          this.positionTimeText.dataset.audioState = AudioState.RECORDING
          break
      }
    }

    const realPosition = positionOverride ?? position
    this.trackListController.outputTimelineController?.draw(realPosition)
    this.x = this.getXValueForSample(realPosition) + 14 * this.trackListController.rootFontSize

    this.positionLineSvg.x1.baseVal.value = this.x
    this.positionLineSvg.x2.baseVal.value = this.x

    const time = TimeUtils.positionToString(realPosition, this.trackListController.sampleRate, true)
    this.positionTimeText.innerHTML = time
    this.positionTimeText.setAttribute('x', `${this.x}`)
  }

  getLabelBoundingBox() {
    return this.positionTimeText.getBBox()
  }
}
