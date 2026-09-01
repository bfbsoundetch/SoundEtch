import { ParameterMetadata } from '../../effects/ParameterMetadata'
import { ParameterValueSequence, ParamValueTransition } from '../../effects/ParameterValueSequence'
import { Track } from '../../project/Track'
import { cloneEffectData, SetTrackEffectsCommand } from '../effects/SetTrackEffectsCommand'
import { TrackListItemController } from './TrackListItemController'
import { TrackListController } from './TrackListController'

export class AutomationController extends TrackListItemController {
  private readonly groupElement = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  private readonly svgPathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  private readonly blockerElement = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  private readonly scaleForeignObject = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject')
  private readonly paramVals: ParameterValueSequence
  private readonly pointElements = new Array<SVGCircleElement>()
  private width: number
  private height: number

  constructor(
    trackListController: TrackListController,
    private readonly effectInstanceId: string,
    private readonly svgElement: SVGSVGElement,
    private readonly track: Track,
    private readonly parameterMetadata: ParameterMetadata,
    private readonly topOffset: number,
  ) {
    super(trackListController)
    this.width = svgElement.viewBox.baseVal.width || svgElement.clientWidth
    this.height = svgElement.viewBox.baseVal.height || svgElement.clientHeight
    const effectData = track.effectRegions.find((effect) => effect.instanceId == effectInstanceId)
    if (!effectData?.params[parameterMetadata.id]) {
      throw new Error(`Parameter ${parameterMetadata.id} is unavailable`)
    }
    this.paramVals = effectData.params[parameterMetadata.id]

    this.groupElement.classList.add('automation-layer')
    this.blockerElement.setAttribute('x', '0')
    this.blockerElement.setAttribute('y', `${this.topOffset}`)
    this.blockerElement.setAttribute('width', '100%')
    this.blockerElement.setAttribute('height', `${Math.max(0, this.height - this.topOffset)}`)
    this.blockerElement.classList.add('automation-hit-area')
    for (const eventName of ['mousedown', 'click', 'contextmenu']) {
      this.blockerElement.addEventListener(eventName, (event) => {
        event.preventDefault()
        event.stopPropagation()
      })
    }
    this.blockerElement.addEventListener('dblclick', (event) => {
      event.preventDefault()
      event.stopPropagation()
      const oldEffects = cloneEffectData(this.track.effectRegions)
      const point = this.eventToLocalPoint(event)
      this.addNewPoint(point.x, point.y)
      void this.recordAppliedChange(oldEffects, `add ${parameterMetadata.displayName} automation point`)
    })

    this.svgPathElement.classList.add('automation-path')
    this.scaleForeignObject.classList.add('automation-scale-container')
    this.scaleForeignObject.appendChild(this.createAutomationScale(parameterMetadata))
    this.resizeAutomationScale()
    this.groupElement.append(this.blockerElement, this.scaleForeignObject, this.svgPathElement)
    this.svgElement.appendChild(this.groupElement)
  }

  draw() {
    this.pointElements.forEach((element) => element.remove())
    this.pointElements.splice(0)

    const initialPoint = {
      pointX: this.getXValueForSample(0),
      pointY: this.getYValue(this.paramVals.initialValue),
    }
    const transitionPoints = this.paramVals.transitionSequence.map((point) => ({
      pointX: this.getXValueForSample(point.startSample),
      pointY: this.getYValue(point.startValue),
    }))
    const lastPoint = transitionPoints.at(-1) ?? initialPoint
    const points = [
      initialPoint,
      ...transitionPoints,
      { pointX: Math.max(this.width, lastPoint.pointX), pointY: lastPoint.pointY },
    ]
    this.svgPathElement.setAttribute('d', 'M ' + points.map((point) => `${point.pointX} ${point.pointY}`).join(' L '))

    for (const point of this.paramVals.transitionSequence) {
      const circleElement = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
      circleElement.classList.add('automation-point')
      circleElement.setAttribute('r', '6')
      circleElement.setAttribute('cx', String(this.getXValueForSample(point.startSample)))
      circleElement.setAttribute('cy', String(this.getYValue(point.startValue)))
      circleElement.addEventListener('mousedown', (event) => this.startMovingPoint(event, point))
      this.groupElement.appendChild(circleElement)
      this.pointElements.push(circleElement)
    }
  }

  resize() {
    this.width = this.svgElement.viewBox.baseVal.width || this.svgElement.clientWidth
    this.height = this.svgElement.viewBox.baseVal.height || this.svgElement.clientHeight
    this.blockerElement.setAttribute('height', `${Math.max(0, this.height - this.topOffset)}`)
    this.resizeAutomationScale()
    this.draw()
  }

  remove() {
    this.groupElement.remove()
  }

  modifyPoint(point: ParamValueTransition, x: number, y: number) {
    point.startSample = Math.max(0, this.getSampleForXValue(this.clamp(x, 0, this.width)))
    point.startValue = this.getValueForY(y)
    this.paramVals.transitionSequence.sort((first, second) => first.startSample - second.startSample)
    this.draw()
  }

  addNewPoint(x: number, y: number) {
    const position = Math.max(0, this.getSampleForXValue(this.clamp(x, 0, this.width)))
    const value = this.getValueForY(y)
    let i = 0
    for (; i < this.paramVals.transitionSequence.length; ++i) {
      if (this.paramVals.transitionSequence[i].startSample > position) {
        break
      }
    }
    this.paramVals.transitionSequence.splice(i, 0, {
      startSample: position,
      startValue: value,
      type: 'linear',
    })
    this.draw()
  }

  private getYValue(value: number) {
    return this.topOffset + (this.height - this.topOffset) * (1 - this.parameterMetadata.normalize(value))
  }

  private getValueForY(y: number) {
    const automationHeight = Math.max(1, this.height - this.topOffset)
    return this.parameterMetadata.denormalize(
      1 - this.clamp(y - this.topOffset, 0, automationHeight) / automationHeight,
    )
  }

  private startMovingPoint(event: MouseEvent, point: ParamValueTransition) {
    event.preventDefault()
    event.stopPropagation()
    const oldEffects = cloneEffectData(this.track.effectRegions)
    const move = (moveEvent: MouseEvent) => {
      const position = this.eventToLocalPoint(moveEvent)
      this.modifyPoint(point, position.x, position.y)
    }
    const finish = () => {
      document.removeEventListener('mousemove', move)
      void this.recordAppliedChange(oldEffects, `move ${this.parameterMetadata.displayName} automation point`)
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', finish, { once: true })
  }

  private eventToLocalPoint(event: MouseEvent) {
    const point = this.svgElement.createSVGPoint()
    point.x = event.clientX
    point.y = event.clientY
    return point.matrixTransform(this.svgElement.getScreenCTM()!.inverse())
  }

  private createAutomationScale(parameterMetadata: ParameterMetadata) {
    const scale = document.createElement('div')
    scale.className = 'automation-scale'
    scale.setAttribute('aria-label', `${parameterMetadata.displayName} scale`)
    const scaleValues = [...parameterMetadata.scaleValues].sort((a, b) => b - a)
    for (const value of scaleValues) {
      const tick = document.createElement('span')
      tick.className = 'automation-scale-tick'
      tick.style.top = `${(1 - parameterMetadata.normalize(value)) * 100}%`
      tick.textContent = parameterMetadata.displayValue(value)
      scale.appendChild(tick)
    }
    return scale
  }
  private resizeAutomationScale() {
    this.scaleForeignObject.setAttribute('x', '0')
    this.scaleForeignObject.setAttribute('y', `${this.topOffset}`)
    this.scaleForeignObject.setAttribute('width', `${4 * this.trackListController.rootFontSize}`)
    this.scaleForeignObject.setAttribute('height', `${Math.max(0, this.height - this.topOffset)}`)
  }

  private async recordAppliedChange(oldEffects: ReturnType<typeof cloneEffectData>, description: string) {
    await this.trackListController.history.recordApplied(
      new SetTrackEffectsCommand(this.track, oldEffects, this.track.effectRegions, description),
    )
  }

  private clamp(value: number, minimum: number, maximum: number) {
    return Math.min(maximum, Math.max(minimum, value))
  }
}
