import { ParameterValueSequence, ParamValueTransition } from '../../effects/ParameterValueSequence'
import { Track } from '../../project/Track'
import { TrackListItemController } from './TrackListItemController'
import { TrackListController } from './TrackListController'
import { WamParameterInfo, WebAudioModule } from '@webaudiomodules/api'
import { AutomationData } from '../../effects/EffectData'

export class AutomationController extends TrackListItemController {
  private readonly svgPathElement: SVGPathElement
  private readonly paramVals: Array<AutomationData>
  private width: number
  private height: number
  private rangeMin: number
  private rangeMax: number

  constructor(
    trackListController: TrackListController,
    effectId: string,
    private readonly groupElement: SVGGElement,
    private readonly track: Track,
    private readonly wamParameterInfo: WamParameterInfo,
    private readonly normalizedInitialValue: number,
  ) {
    super(trackListController)
    this.width = groupElement.parentElement!.clientWidth
    this.height = groupElement.parentElement!.clientHeight
    console.error(this.width, this.height, normalizedInitialValue, JSON.stringify(wamParameterInfo))

    this.svgPathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    this.svgPathElement.addEventListener('mousedown', () => {
      console.log('path down')
    })
    groupElement.appendChild(this.svgPathElement)
    this.paramVals = track.effectRegions.find(e => e.id == effectId)!.values

    switch (this.wamParameterInfo.type) {
      case 'boolean':
        this.rangeMax = 1
        this.rangeMin = 0
        break
      case 'float':
      case 'int':
        this.rangeMax = this.wamParameterInfo.maxValue
        this.rangeMin = this.wamParameterInfo.minValue
        break
      case 'choice':
        this.rangeMax = this.wamParameterInfo.choices.length
        this.rangeMin = 0
        break
    }
  }

  draw() {
    if (this.paramVals.length == 0) {
      this.svgPathElement.setAttribute('d', `M 0 ${this.normalizedInitialValue * this.height} L ${this.width} ${this.normalizedInitialValue * this.height}`)
      return
    }
    const pointCircles = new Array<SVGCircleElement>()
    const points = []
    for (const point of this.paramVals) {
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

  modifyPoint(point: AutomationData, x: number, y: number) {
    const position = this.getSampleForXValue(x)
    const value = this.wamParameterInfo.denormalize((this.height - y) / this.height)
    point.startSample = position
    point.startValue = value
    this.draw()
  }

  addNewPoint(x: number, y: number) {
    const position = this.getSampleForXValue(x)
    const value = this.wamParameterInfo.denormalize((this.height - y) / this.height)
    let i = 0
    for (; i < this.paramVals.length; ++i) {
      if (this.paramVals[i].startSample > position) {
        break
      }
    }
    this.paramVals.splice(i, 0, {
      startSample: position,
      startValue: value,
      skew: 0
    })
    this.draw()
  }
}
