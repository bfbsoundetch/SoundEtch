import { KeyPressController } from '../KeyPressController'
import { TrackListController } from './TrackListController'
import { TrackListItemController } from './TrackListItemController'
import { Waveform } from './Waveform'

export class TimelineRegionController extends TrackListItemController {
  private firstPosition = 0
  private secondPosition = 0
  private readonly waveformElements = new Map<
    Waveform,
    {
      rect: SVGRectElement
      leftExpand: SVGLineElement
      rightExpand: SVGLineElement
    }
  >()

  private draggedFirstWaveform: Waveform | null = null

  constructor(
    private readonly singleWaveform: boolean,
    private readonly contextMenuListener: (event: PointerEvent) => any,
    readonly updateListener: () => any,
    trackListController: TrackListController,
  ) {
    super(trackListController)
  }

  get lowSample() {
    return Math.min(this.firstPosition, this.secondPosition)
  }

  get highSample() {
    return Math.max(this.firstPosition, this.secondPosition)
  }

  get selectedRegion() {
    if (this.waveformElements.size == 0 || this.firstPosition == this.secondPosition) {
      return null
    }
    return {
      startSample: Math.min(this.firstPosition, this.secondPosition),
      endSample: Math.max(this.firstPosition, this.secondPosition),
      tracks: [...this.waveformElements.keys()].map((w) => w.track),
    }
  }

  updateSelection(position: number, waveform: Waveform | null, dragged: boolean) {
    position = Math.max(position, 0)
    if (this.waveformElements.size == 0) {
      this.firstPosition = position
    }
    this.secondPosition = position
    if (this.singleWaveform || !dragged || !waveform) {
      if (waveform) {
        this.setUpElementsForWaveform(waveform)
      }
      this.draw()
      return
    }
    if (!this.draggedFirstWaveform) {
      this.draggedFirstWaveform = waveform
    }

    let firstWaveform: Waveform | null = null
    for (const w of this.trackListController.waveforms) {
      if (!firstWaveform && (w == this.draggedFirstWaveform || w == waveform)) {
        firstWaveform = w
      }
      if (firstWaveform) {
        this.setUpElementsForWaveform(w)
      } else if (!KeyPressController.metaPressed) {
        const elements = this.waveformElements.get(w)
        elements?.rect?.remove()
        elements?.leftExpand?.remove()
        elements?.rightExpand?.remove()
        this.waveformElements.delete(w)
      }
      if (
        (w != firstWaveform && (w == this.draggedFirstWaveform || w == waveform)) ||
        this.draggedFirstWaveform == waveform
      ) {
        firstWaveform = null
      }
    }
    this.draw()
  }

  setSelection(startSample: number, endSample: number, waveforms: Set<Waveform>) {
    this.remove()
    this.firstPosition = startSample
    this.secondPosition = endSample
    waveforms.forEach((w) => this.setUpElementsForWaveform(w))
    this.trackListController.pointerStateManager.startSelecting()
    this.draw()
  }

  updateSelectionStartSample(leftExpand: boolean) {
    if (
      (leftExpand && this.firstPosition < this.secondPosition) ||
      (!leftExpand && this.firstPosition > this.secondPosition)
    ) {
      const startSample = this.firstPosition
      this.firstPosition = this.secondPosition
      this.secondPosition = startSample
    }
  }

  updateRange(newLow: number, newHigh: number) {
    this.firstPosition = newLow
    this.secondPosition = newHigh
    this.draw()
  }

  draw(isActive = true) {
    if (this.firstPosition == this.secondPosition) {
      this.waveformElements.values().forEach((v) => {
        v.rect.setAttribute('width', '0')

        v.leftExpand.setAttribute('x1', `-1`)
        v.leftExpand.setAttribute('x2', `-1`)

        v.rightExpand.setAttribute('x2', `-1`)
        v.rightExpand.setAttribute('x1', `-1`)
      })
      if (isActive) {
        this.trackListController.timelineController.removeSelection()
      }
      return
    }
    const lowSample = Math.min(this.firstPosition, this.secondPosition)
    const highSample = Math.max(this.firstPosition, this.secondPosition)
    const lowX = this.getXValueForSample(lowSample)
    const highX = this.getXValueForSample(highSample)

    this.waveformElements.values().forEach((v) => {
      v.rect.setAttribute('x', `${lowX}`)
      v.rect.setAttribute('width', `${highX - lowX}`)

      v.leftExpand.setAttribute('x1', `${lowX}`)
      v.leftExpand.setAttribute('x2', `${lowX}`)

      v.rightExpand.setAttribute('x2', `${highX}`)
      v.rightExpand.setAttribute('x1', `${highX}`)
    })

    if (isActive) {
      this.trackListController.timelineController.drawSelection(lowSample, highSample)
    }
  }

  resize(): void {
    this.waveformElements.forEach((value, key) => {
      value.rect.setAttribute('height', `${key.fullHeight}`)
      value.leftExpand.setAttribute('y2', `${key.fullHeight}`)
      value.rightExpand.setAttribute('y2', `${key.fullHeight}`)
    })
    this.draw()
  }

  remove() {
    this.waveformElements.values().forEach((v) => {
      v.rect.remove()
      v.leftExpand.remove()
      v.rightExpand.remove()
    })
    this.waveformElements.clear()
    this.firstPosition = 0
    this.secondPosition = 0
    this.draggedFirstWaveform = null
    this.trackListController.timelineController.removeSelection()
  }

  isInRegion(waveform: Waveform) {
    return this.waveformElements.has(waveform)
  }

  private setUpElementsForWaveform(waveform: Waveform) {
    if (this.waveformElements.has(waveform)) {
      return
    }
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    const leftExpand = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    const rightExpand = document.createElementNS('http://www.w3.org/2000/svg', 'line')

    waveform.topGroupElement.appendChild(rect)
    waveform.topGroupElement.appendChild(leftExpand)
    waveform.topGroupElement.appendChild(rightExpand)

    rect.setAttribute('y', '0')
    rect.classList = 'waveform-selection'
    rect.addEventListener('mousedown', (event) => {
      event.stopPropagation()
    })
    rect.addEventListener('contextmenu', (event) => {
      this.contextMenuListener(event)
      event.preventDefault()
      event.stopPropagation()
    })
    rect.setAttribute('height', `${waveform.fullHeight}`)

    leftExpand.style.cursor = 'col-resize'
    leftExpand.style.strokeWidth = '10'
    leftExpand.style.strokeOpacity = '0'
    leftExpand.setAttribute('y1', '0')
    leftExpand.setAttribute('y2', `${waveform.fullHeight}`)

    rightExpand.style.cursor = 'col-resize'
    rightExpand.style.strokeWidth = '10'
    rightExpand.style.strokeOpacity = '0'
    rightExpand.setAttribute('y1', '0')
    rightExpand.setAttribute('y2', `${waveform.fullHeight}`)

    leftExpand.addEventListener('mousedown', (event) => {
      if (event.buttons == 1 && event.button == 0) {
        this.updateSelectionStartSample(true)
        this.trackListController.pointerStateManager.startResizingSelection(this)
        event.stopPropagation()
      }
    })

    rightExpand.addEventListener('mousedown', (event) => {
      if (event.buttons == 1 && event.button == 0) {
        this.updateSelectionStartSample(false)
        this.trackListController.pointerStateManager.startResizingSelection(this)
        event.stopPropagation()
      }
    })
    this.waveformElements.set(waveform, { rect, leftExpand, rightExpand })
  }
}
