import { ParameterMetadata } from '../../effects/ParameterMetadata'
import { ParameterValueSequence, ParamValueTransition, type TransitionType } from '../../effects/ParameterValueSequence'
import type { EffectHost } from '../../project/EffectHost'
import { OutputBus } from '../../project/OutputBus'
import { cloneEffectData, SetEffectsCommand } from '../effects/SetEffectsCommand'
import { TopPanelController, type TopPanelTabId } from '../TopPanelController'
import { TrackListItemController } from './TrackListItemController'
import { TrackListController } from './TrackListController'
import { AudioControl } from '../../audiocontext/AudioControl'
const TRANSITION_TYPES: readonly TransitionType[] = ['linear', 'exponential', 'logarithmic', 'scurve']
const TRANSITION_LABELS: Record<TransitionType, string> = {
  linear: 'Linear',
  exponential: 'Exponential',
  logarithmic: 'Logarithmic',
  scurve: 'S-curve',
}
const LOGARITHMIC_CURVE = ParamValueTransition.generateLogCurve()
const EXPONENTIAL_CURVE = ParamValueTransition.generateExpCurve()
const S_CURVE = ParamValueTransition.generateSCurve()

interface PointEditorControls {
  row: HTMLTableRowElement
  number: HTMLTableCellElement
  position: HTMLInputElement
  value: HTMLInputElement
  valuePreview: HTMLOutputElement
  transition: HTMLSelectElement
  deleteButton: HTMLButtonElement
}

export class AutomationController extends TrackListItemController {
  private readonly groupElement = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  private readonly svgPathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  private readonly blockerElement = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  private readonly scaleForeignObject = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject')
  private readonly topPanelController = TopPanelController.getInstance()
  /** The point editor opens in the tab that shows the host's effect chain. */
  private readonly panelTab: TopPanelTabId
  private readonly pointEditorControls = new Map<ParamValueTransition, PointEditorControls>()
  private pointEditorTableBody: HTMLTableSectionElement | null = null
  private pointEditorIsOpen = false
  private readonly pointElements = new Array<SVGCircleElement>()
  private readonly pointLabelElements = new Array<SVGTextElement>()
  private width: number
  private height: number

  constructor(
    trackListController: TrackListController,
    private readonly effectInstanceId: string,
    private readonly svgElement: SVGSVGElement,
    private readonly host: EffectHost,
    private readonly parameterMetadata: ParameterMetadata,
    private readonly topOffset: number,
  ) {
    super(trackListController)
    this.panelTab = host instanceof OutputBus ? 'output' : 'tracks'
    this.width = svgElement.viewBox.baseVal.width || svgElement.clientWidth
    this.height = svgElement.viewBox.baseVal.height || svgElement.clientHeight
    const effectData = host.effectRegions.find((effect) => effect.instanceId == effectInstanceId)
    if (!effectData?.params[parameterMetadata.id]) {
      throw new Error(`Parameter ${parameterMetadata.id} is unavailable`)
    }

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
      const oldEffects = cloneEffectData(this.host.effectRegions)
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
    this.openPointEditor()
  }

  draw() {
    this.pointElements.forEach((element) => element.remove())
    this.pointElements.splice(0)
    this.pointLabelElements.forEach((element) => element.remove())
    this.pointLabelElements.splice(0)

    const points = this.getAutomationPathPoints()
    this.svgPathElement.setAttribute('d', 'M ' + points.map((point) => `${point.x} ${point.y}`).join(' L '))

    for (const point of this.paramVals.transitionSequence) {
      const x = this.getXValueForSample(point.startSample)
      const y = this.getYValue(point.startValue)
      const circleElement = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
      circleElement.classList.add('automation-point')
      circleElement.setAttribute('r', '6')
      circleElement.setAttribute('cx', String(x))
      circleElement.setAttribute('cy', String(y))
      circleElement.addEventListener('mousedown', (event) => this.startMovingPoint(event, point))
      this.groupElement.appendChild(circleElement)
      this.pointElements.push(circleElement)

      const labelElement = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      labelElement.classList.add('automation-point-label')
      labelElement.textContent = this.parameterMetadata.displayValue(point.startValue)
      this.groupElement.appendChild(labelElement)
      this.pointLabelElements.push(labelElement)

      const labelGap = 10
      const labelWidth = labelElement.getComputedTextLength()
      const placeLeft = x + labelGap + labelWidth > this.width
      labelElement.setAttribute('x', `${placeLeft ? x - labelGap : x + labelGap}`)
      labelElement.classList.toggle('automation-point-label-left', placeLeft)

      const labelHeight = labelElement.getBBox().height
      const placeBelow = y - labelGap - labelHeight < this.topOffset
      labelElement.setAttribute('y', `${placeBelow ? y + labelGap : y - labelGap}`)
      labelElement.classList.toggle('automation-point-label-below', placeBelow)
    }
    this.syncPointEditor()
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
    this.pointEditorIsOpen = false
    this.pointEditorControls.clear()
    this.pointEditorTableBody = null
    this.topPanelController.close(this)
  }

  modifyPoint(point: ParamValueTransition, x: number, y: number) {
    point.startSample = Math.max(0, this.getSampleForXValue(this.clamp(x, 0, this.width)))
    point.startValue = this.getValueForY(y)
    this.paramVals.transitionSequence.sort((first, second) => first.startSample - second.startSample)
    this.draw()
  }

  addNewPoint(x: number, y: number) {
    const position = Math.max(0, this.getSampleForXValue(this.clamp(x, 0, this.width)))
    this.insertPoint(position, this.getValueForY(y))
  }

  private insertPoint(sample: number, value: number): ParamValueTransition {
    let i = 0
    for (; i < this.paramVals.transitionSequence.length; ++i) {
      if (this.paramVals.transitionSequence[i].startSample > sample) {
        break
      }
    }
    const point: ParamValueTransition = {
      startSample: sample,
      startValue: value,
      type: 'linear',
    }
    this.paramVals.transitionSequence.splice(i, 0, point)
    this.draw()
    this.openPointEditor()
    return point
  }

  private get paramVals(): ParameterValueSequence {
    const sequence = this.host.effectRegions.find((effect) => effect.instanceId == this.effectInstanceId)?.params[
      this.parameterMetadata.id
    ]
    if (!sequence) {
      throw new Error(`Parameter ${this.parameterMetadata.id} is unavailable`)
    }
    return sequence
  }

  private getAutomationPathPoints() {
    const points = [
      {
        x: this.getXValueForSample(0),
        y: this.getYValue(this.paramVals.initialValue),
      },
    ]
    let previousSample = 0
    let previousValue = this.paramVals.initialValue
    for (const transition of this.paramVals.transitionSequence) {
      const values = this.getTransitionValues(previousValue, transition)
      for (let i = 1; i < values.length; ++i) {
        const progress = i / (values.length - 1)
        const sample = previousSample + (transition.startSample - previousSample) * progress
        points.push({
          x: this.getXValueForSample(sample),
          y: this.getYValue(values[i]),
        })
      }
      previousSample = transition.startSample
      previousValue = transition.startValue
    }
    const lastPoint = points.at(-1)!
    points.push({ x: Math.max(this.width, lastPoint.x), y: lastPoint.y })
    return points
  }

  private getTransitionValues(previousValue: number, transition: ParamValueTransition) {
    if (transition.type == 'linear') {
      return [previousValue, transition.startValue]
    }
    const curve =
      transition.type == 'logarithmic' ? LOGARITHMIC_CURVE : transition.type == 'scurve' ? S_CURVE : EXPONENTIAL_CURVE
    return curve.map((value) => previousValue + value * (transition.startValue - previousValue))
  }

  private openPointEditor() {
    if (this.pointEditorIsOpen) {
      return
    }
    this.pointEditorIsOpen = true
    this.topPanelController.open({
      tab: this.panelTab,
      owner: this,
      title: `${this.parameterMetadata.displayName} automation`,
      subtitle: `${this.host.name} · ${this.paramVals.transitionSequence.length} points`,
      body: this.createPointEditor(),
      onBack: () => this.trackListController.exitAutomationMode(),
      onClose: () => {
        this.pointEditorIsOpen = false
        this.pointEditorControls.clear()
        this.pointEditorTableBody = null
      },
    })
    this.topPanelController.reveal(this.panelTab, this.svgElement)
  }

  private createPointEditor() {
    const body = document.createElement('div')
    body.className = 'automation-point-editor'
    this.pointEditorControls.clear()
    this.pointEditorTableBody = null
    const addPointButton = document.createElement('button')
    addPointButton.type = 'button'
    addPointButton.className = 'bordered clickable automation-add-point-button'
    addPointButton.textContent = 'Add point at cursor'
    addPointButton.addEventListener('click', () => {
      const sample = AudioControl.startPosition
      const value =
        this.paramVals.transitionSequence.findLast((transition) => transition.startSample <= sample)?.startValue ??
        this.paramVals.initialValue
      const oldEffects = cloneEffectData(this.host.effectRegions)
      const point = this.insertPoint(sample, value)
      void this.recordAppliedChange(oldEffects, `add ${this.parameterMetadata.displayName} automation point`)
      this.pointEditorControls.get(point)?.position.focus()
    })
    body.appendChild(addPointButton)
    if (this.paramVals.transitionSequence.length == 0) {
      const message = document.createElement('p')
      message.className = 'automation-point-editor-empty'
      message.textContent = 'Double-click the automation curve or choose Add point at cursor.'
      body.appendChild(message)
      return body
    }

    const table = document.createElement('table')
    table.className = 'automation-point-table'
    const head = document.createElement('thead')
    const headingRow = document.createElement('tr')
    for (const heading of [
      'Point',
      'Time (seconds)',
      this.parameterMetadata.displayName,
      'Transition to point',
      'Actions',
    ]) {
      const cell = document.createElement('th')
      cell.scope = 'col'
      cell.textContent = heading
      headingRow.appendChild(cell)
    }
    head.appendChild(headingRow)

    const tableBody = document.createElement('tbody')
    this.pointEditorTableBody = tableBody
    this.paramVals.transitionSequence.forEach((point, index) => {
      tableBody.appendChild(this.createPointEditorRow(point, index))
    })
    table.append(head, tableBody)
    body.appendChild(table)
    return body
  }

  private createPointEditorRow(point: ParamValueTransition, index: number) {
    const row = document.createElement('tr')
    const number = document.createElement('th')
    number.scope = 'row'

    const positionCell = document.createElement('td')
    const position = document.createElement('input')
    position.type = 'number'
    position.min = '0'
    position.step = '0.001'
    position.setAttribute('aria-label', `Point ${index + 1} time in seconds`)
    position.addEventListener('change', () => {
      const seconds = position.valueAsNumber
      if (!Number.isFinite(seconds)) {
        this.syncPointEditor()
        return
      }
      const startSample = Math.max(0, Math.round(seconds * this.trackListController.sampleRate))
      if (startSample == point.startSample) {
        this.syncPointEditor()
        return
      }
      this.commitPointEdit(point, `change ${this.parameterMetadata.displayName} automation point time`, () => {
        point.startSample = startSample
      })
    })
    positionCell.appendChild(position)

    const valueCell = document.createElement('td')
    const valueField = document.createElement('div')
    valueField.className = 'automation-point-value-field'
    const value = document.createElement('input')
    value.type = 'number'
    value.min = String(this.parameterMetadata.minValue)
    value.max = String(this.parameterMetadata.maxValue)
    value.step = this.parameterMetadata.increment ? String(this.parameterMetadata.increment) : 'any'
    value.setAttribute('aria-label', `Point ${index + 1} ${this.parameterMetadata.displayName}`)
    const valuePreview = document.createElement('output')
    valuePreview.className = 'automation-point-value-preview'
    value.addEventListener('input', () => {
      if (Number.isFinite(value.valueAsNumber)) {
        const boundedValue = this.clamp(
          value.valueAsNumber,
          this.parameterMetadata.minValue,
          this.parameterMetadata.maxValue,
        )
        valuePreview.textContent = this.parameterMetadata.displayValue(boundedValue)
      }
    })
    value.addEventListener('change', () => {
      if (!Number.isFinite(value.valueAsNumber)) {
        this.syncPointEditor()
        return
      }
      const boundedValue = this.clamp(
        value.valueAsNumber,
        this.parameterMetadata.minValue,
        this.parameterMetadata.maxValue,
      )
      if (boundedValue == point.startValue) {
        this.syncPointEditor()
        return
      }
      this.commitPointEdit(point, `change ${this.parameterMetadata.displayName} automation point value`, () => {
        point.startValue = boundedValue
      })
    })
    valueField.append(value, valuePreview)
    valueCell.appendChild(valueField)

    const transitionCell = document.createElement('td')
    const transition = document.createElement('select')
    transition.setAttribute('aria-label', `Point ${index + 1} transition type`)
    for (const transitionType of TRANSITION_TYPES) {
      const option = document.createElement('option')
      option.value = transitionType
      option.textContent = TRANSITION_LABELS[transitionType]
      transition.appendChild(option)
    }
    transition.addEventListener('change', () => {
      const transitionType = transition.value as TransitionType
      if (transitionType == point.type) {
        return
      }
      this.commitPointEdit(point, `change ${this.parameterMetadata.displayName} automation transition`, () => {
        point.type = transitionType
      })
    })
    transitionCell.appendChild(transition)

    const actionsCell = document.createElement('td')
    const deleteButton = document.createElement('button')
    deleteButton.type = 'button'
    deleteButton.className = 'bordered clickable'
    deleteButton.textContent = 'Delete'
    deleteButton.addEventListener('click', () => {
      const points = this.paramVals.transitionSequence
      const pointIndex = points.indexOf(point)
      if (pointIndex < 0) {
        return
      }
      this.commitPointEdit(point, `delete ${this.parameterMetadata.displayName} automation point`, () => {
        points.splice(pointIndex, 1)
      })
    })
    actionsCell.appendChild(deleteButton)

    row.append(number, positionCell, valueCell, transitionCell, actionsCell)
    this.pointEditorControls.set(point, {
      row,
      number,
      position,
      value,
      valuePreview,
      transition,
      deleteButton,
    })
    this.updatePointEditorControls(point, index, this.pointEditorControls.get(point)!)
    return row
  }

  private syncPointEditor() {
    if (!this.pointEditorIsOpen) {
      return
    }
    const points = this.paramVals.transitionSequence
    this.topPanelController.setSubtitle(this, `${this.host.name} · ${points.length} points`)
    if (points.length == 0) {
      if (this.pointEditorControls.size > 0 || this.pointEditorTableBody) {
        this.rebuildPointEditor()
      }
      return
    }
    if (
      !this.pointEditorTableBody ||
      this.pointEditorControls.size != points.length ||
      points.some((point) => !this.pointEditorControls.has(point))
    ) {
      this.rebuildPointEditor()
      return
    }
    const body = this.pointEditorTableBody
    points.forEach((point, index) => {
      const controls = this.pointEditorControls.get(point)!
      this.updatePointEditorControls(point, index, controls)
      if (body.children[index] !== controls.row) {
        const focused = controls.row.contains(document.activeElement) ? (document.activeElement as HTMLElement) : null
        body.insertBefore(controls.row, body.children[index] ?? null)
        focused?.focus()
      }
    })
  }

  private rebuildPointEditor() {
    const panel = `#top-panel-${this.panelTab}`
    const hadFocus =
      document.querySelector(`${panel} .automation-point-editor`)?.contains(document.activeElement) ?? false
    this.topPanelController.setBody(this, this.createPointEditor())
    if (hadFocus) document.querySelector<HTMLElement>(`${panel} .automation-add-point-button`)?.focus()
  }

  private updatePointEditorControls(point: ParamValueTransition, index: number, controls: PointEditorControls) {
    controls.number.textContent = String(index + 1)
    controls.position.value = (point.startSample / this.trackListController.sampleRate).toFixed(3)
    controls.position.setAttribute('aria-label', `Point ${index + 1} time in seconds`)
    controls.value.value = this.formatEditableValue(point.startValue)
    controls.value.setAttribute('aria-label', `Point ${index + 1} ${this.parameterMetadata.displayName}`)
    controls.valuePreview.textContent = this.parameterMetadata.displayValue(point.startValue)
    controls.transition.value = point.type
    controls.transition.setAttribute('aria-label', `Point ${index + 1} transition type`)
    controls.deleteButton.setAttribute('aria-label', `Delete point ${index + 1}`)
  }

  private formatEditableValue(value: number) {
    const increment = this.parameterMetadata.increment
    if (!increment) {
      return String(value)
    }
    const fractionDigits = String(increment).split('.')[1]?.length ?? 0
    return value.toFixed(fractionDigits)
  }

  private commitPointEdit(point: ParamValueTransition, description: string, apply: () => void) {
    const oldEffects = cloneEffectData(this.host.effectRegions)
    apply()
    this.paramVals.transitionSequence.sort((first, second) => first.startSample - second.startSample)
    this.draw()
    void this.recordAppliedChange(oldEffects, description)
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
    this.openPointEditor()
    const oldEffects = cloneEffectData(this.host.effectRegions)
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
    this.scaleForeignObject.setAttribute('aria-hidden', 'true')
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
      new SetEffectsCommand(this.host, oldEffects, this.host.effectRegions, description),
    )
  }

  private clamp(value: number, minimum: number, maximum: number) {
    return Math.min(maximum, Math.max(minimum, value))
  }
}
