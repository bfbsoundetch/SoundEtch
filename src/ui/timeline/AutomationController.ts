import { ParameterValueSequence, ParamValueTransition } from '../../effects/ParameterValueSequence'
import { Track } from '../../project/Track'
import { TrackListItemController } from './TrackListItemController'
import { TrackListController } from './TrackListController'

export class AutomationController extends TrackListItemController {
  private readonly topSvgElement: SVGElement
  private readonly svgPathElement: SVGPathElement
  private width = 0
  private height = 0
  private rangeMin: number
  private rangeMax: number

  constructor(
    trackListController: TrackListController,
    private readonly div: HTMLDivElement,
    private readonly track: Track,
    private readonly paramVals: ParameterValueSequence,
  ) {
    super(trackListController)
    this.topSvgElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    this.topSvgElement.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    this.topSvgElement.id = `automation-parent-${this.track.id}`
    this.topSvgElement.style.height = '100%'
    this.topSvgElement.style.width = '100%'
    this.topSvgElement.style.display = 'block'
    this.div.appendChild(this.topSvgElement)
    this.topSvgElement.setAttribute('viewBox', `0 0 ${this.width} ${this.height}`)

    this.svgPathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    this.svgPathElement.addEventListener('mousedown', () => {
      console.log('path down')
    })
    this.topSvgElement.appendChild(this.svgPathElement)

    switch (this.paramVals.param.type) {
      case 'boolean':
        this.rangeMax = 1
        this.rangeMin = 0
        break
      case 'float':
      case 'int':
        this.rangeMax = this.paramVals.param.maxValue
        this.rangeMin = this.paramVals.param.minValue
        break
      case 'choice':
        this.rangeMax = this.paramVals.param.choices.length
        this.rangeMin = 0
        break
    }
  }

  draw() {
    const pointCircles = new Array<SVGCircleElement>()
    let path = 'M '
    for (const point of this.paramVals.transitionSequence) {
      const pointX = this.getXValueForSample(point.position)
      if (pointX >= 0 && pointX <= this.width) {
        const pointY = this.height * (1 - (point.startValue - this.rangeMin) / (this.rangeMax - this.rangeMin))
        path += ` ${pointX} ${pointY} L`

        const circleElement = new SVGCircleElement()
        circleElement.r.baseVal.value = 3
        circleElement.cx.baseVal.value = pointX
        circleElement.cy.baseVal.value = pointY
        this.topSvgElement.appendChild(circleElement)

        circleElement.addEventListener('mousedown', () => {
          console.log('circle down')
        })
      }
    }
    path = path.substring(0, path.length - 2)
    this.svgPathElement.setAttribute('d', path)
  }

  resize() {
    this.width = this.div.clientWidth
    this.height = this.div.clientHeight
    this.topSvgElement.setAttribute('viewBox', `0 0 ${this.width} ${this.height}`)
  }

  modifyPoint(point: ParamValueTransition, x: number, y: number) {
    const position = this.getSampleForXValue(x)
    const value = ((this.height - y) / this.height) * (this.rangeMax - this.rangeMin) + this.rangeMin
    point.position = position
    point.startValue = value
  }

  addNewPoint(x: number, y: number) {
    const position = this.getSampleForXValue(x)
    const value = ((this.height - y) / this.height) * (this.rangeMax - this.rangeMin) + this.rangeMin
    let i = 0
    for (; i < this.paramVals.transitionSequence.length; ++i) {
      if (this.paramVals.transitionSequence[i].position > position) {
        break
      }
    }
    this.paramVals.transitionSequence.splice(i, 0, new ParamValueTransition('linear', value, position))
    this.draw()
  }
}
