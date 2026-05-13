import { TimeUtils } from '../../global/TimeUtils'
import { AudioState, AudioControl, isPausedState } from '../../audiocontext/AudioControl'
import { TrackListController } from './TrackListController'
import { TrackListItemController } from './TrackListItemController'

export class PositionMarkerController extends TrackListItemController {
  readonly positionMarkerSvg = document.getElementById('position-marker') as unknown as SVGSVGElement
  private readonly positionLineSvg = document.getElementById('position-line') as unknown as SVGLineElement
  private readonly positionTimeText = document.getElementById('pointer-position-text') as unknown as SVGTextElement

  constructor(trackListController: TrackListController) {
    super(trackListController)
    this.resize()
    this.positionLineSvg.addEventListener('mousemove', (event) => {
      event.preventDefault()
    })
    this.positionLineSvg.addEventListener('wheel', (event) => {
      event.preventDefault()
    })
  }

  resize() {
    const height = document.body.clientHeight - this.positionMarkerSvg.getBoundingClientRect().y
    this.positionMarkerSvg.setAttribute('height', `${height}`)
    this.positionLineSvg.setAttribute('y2', `${height}`)
    this.positionMarkerSvg.setAttribute('viewBox', `0 0 ${this.positionLineSvg.parentElement!.clientWidth} ${height}`)
  }

  hidePositionMarker() {
    this.positionLineSvg.x1.baseVal.value = -100
    this.positionLineSvg.x2.baseVal.value = -100
    this.positionTimeText.setAttribute('x', '-100')
  }

  draw(positionOverride: number | null = null) {
    let position
    if (AudioControl.getState() == AudioState.STOPPED || AudioControl.getState() == AudioState.MONITORING) {
      if (AudioControl.startPosition == 0) {
        this.hidePositionMarker()
        return
      }
      position = AudioControl.startPosition
      this.positionLineSvg.classList = 'blink'
    } else {
      position = AudioControl.audioContext!.getPosition()
      this.positionLineSvg.classList = ''
    }

    const realPosition = positionOverride ?? position
    const x = this.getXValueForSample(realPosition)

    this.positionLineSvg.x1.baseVal.value = x
    this.positionLineSvg.x2.baseVal.value = x

    this.positionLineSvg.addEventListener('mousedown', (event) => {
      if (event.buttons == 1 && event.button == 0) {
        this.trackListController.pointerStateManager.startMovingMark()
        event.stopPropagation()
      }
    })

    this.positionLineSvg.style.visibility = 'visible'
    this.positionTimeText.style.visibility = 'visible'
    this.positionTimeText.style.fontWeight = 'bold'
    this.positionTimeText.style.fontSize = '18px'
    const time = TimeUtils.positionToString(realPosition, this.trackListController.sampleRate, true)
    this.positionTimeText.innerHTML = time
    this.positionTimeText.setAttribute('x', `${x}`)
  }
}
