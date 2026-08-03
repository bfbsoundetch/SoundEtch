import { ParameterValueSequence, ParamValueTransition } from '../../effects/ParameterValueSequence'
import { Track } from '../../project/Track'
import { TrackListItemController } from './TrackListItemController'
import { TrackListController } from './TrackListController'
import { WamParameterInfo, WebAudioModule } from '@webaudiomodules/api'
import { ParameterMetadata } from 'effects/ParameterMetadata'

export class AutomationController extends TrackListItemController {
  private readonly svgPathElement: SVGPathElement
  private readonly paramVals: ParameterValueSequence
  private width: number
  private height: number

  constructor(
    trackListController: TrackListController,
    effectId: string,
    private readonly groupElement: SVGGElement,
    private readonly track: Track,
    private readonly parameterMetadata: ParameterMetadata,
    private readonly normalizedInitialValue: number,
  ) {
    super(trackListController)
    this.width = groupElement.parentElement!.clientWidth
    this.height = groupElement.parentElement!.clientHeight
    console.error(this.width, this.height, normalizedInitialValue, JSON.stringify(parameterMetadata))

    this.svgPathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    this.svgPathElement.addEventListener('mousedown', () => {
      console.log('path down')
    })
    groupElement.appendChild(this.svgPathElement)
    this.paramVals = track.effectRegions.find(e => e.id == effectId)!.params[parameterMetadata.name]
  }

  draw() {
    if (this.paramVals.transitionSequence.length == 0) {
      this.svgPathElement.setAttribute('d', `M 0 ${this.normalizedInitialValue * this.height} L ${this.width} ${this.normalizedInitialValue * this.height}`)
      return
    }
    const pointCircles = new Array<SVGCircleElement>()
    const points = []
    for (const point of this.paramVals.transitionSequence) {
      const pointX = this.getXValueForSample(point.startSample)
      const pointY = this.height * (1 - point.startValue)
      points.push({pointX, pointY})

      const circleElement = new SVGCircleElement()
      circleElement.r.baseVal.value = 3
      circleElement.cx.baseVal.value = pointX
      circleElement.cy.baseVal.value = pointY
      this.groupElement.appendChild(circleElement)

      circleElement.addEventListener('mousedown', () => {
        console.log('circle down')
      })
    }
    this.svgPathElement.setAttribute('d', 'M ' + points.map(p => `${p.pointX} ${p.pointY}`).join(' L '))
  }

  resize() {
    this.width = this.groupElement.clientWidth
    this.height = this.groupElement.clientHeight
  }

  modifyPoint(point: ParamValueTransition, x: number, y: number) {
    const position = this.getSampleForXValue(x)
    const value = this.parameterMetadata.denormalize((this.height - y) / this.height)
    point.startSample = position
    point.startValue = value
    this.draw()
  }

  addNewPoint(x: number, y: number) {
    const position = this.getSampleForXValue(x)
    const value = this.parameterMetadata.denormalize((this.height - y) / this.height)
    let i = 0
    for (; i < this.paramVals.transitionSequence.length; ++i) {
      if (this.paramVals.transitionSequence[i].startSample > position) {
        break
      }
    }
    this.paramVals.transitionSequence.splice(i, 0, {
      startSample: position,
      startValue: value,
      type: 'linear'
    })
    this.draw()
  }
}
