import { TrackListController } from './TrackListController'
import { TrackListItemController } from './TrackListItemController'
import { Waveform } from './Waveform'

export class TimelineRegionController extends TrackListItemController {
  private readonly rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  private readonly leftExpand = document.createElementNS('http://www.w3.org/2000/svg', 'line')
  private readonly rightExpand = document.createElementNS('http://www.w3.org/2000/svg', 'line')

  constructor(
    private lowSample: number,
    private highSample: number,
    private readonly waveform: Waveform,
    contextMenuListener: (event: PointerEvent) => any,
    leftResizeListener: (event: MouseEvent) => any,
    rightResizeListener: (event: MouseEvent) => any,
    trackListController: TrackListController,
  ) {
    super(trackListController)
    waveform.topGroupElement.appendChild(this.rect)
    waveform.topGroupElement.appendChild(this.leftExpand)
    waveform.topGroupElement.appendChild(this.rightExpand)

    this.rect.setAttribute('y', '0')
    this.rect.classList = 'waveform-selection'
    this.rect.addEventListener('mousedown', (event) => {
      event.stopPropagation()
    })
    this.rect.addEventListener('contextmenu', contextMenuListener)
    this.rect.addEventListener('contextmenu', (event) => {
      contextMenuListener(event)
      this.trackListController.timelineSelectionContextMenu.draw(event.clientX, event.clientY)
      event.preventDefault()
      event.stopPropagation()
    })

    this.leftExpand.style.cursor = 'col-resize'
    this.leftExpand.style.strokeWidth = '10'
    this.leftExpand.style.strokeOpacity = '0'
    this.leftExpand.setAttribute('y1', '0')

    this.rightExpand.style.cursor = 'col-resize'
    this.rightExpand.style.strokeWidth = '10'
    this.rightExpand.style.strokeOpacity = '0'
    this.rightExpand.setAttribute('y1', '0')

    this.leftExpand.addEventListener('mousedown', leftResizeListener)
    this.leftExpand.addEventListener('mousedown', (event) => {
      if (event.buttons == 1 && event.button == 0) {
        leftResizeListener(event)
        this.trackListController.pointerStateManager.startResizingSelection(true)
        event.stopPropagation()
      }
    })

    this.rightExpand.addEventListener('mousedown', rightResizeListener)
    this.rightExpand.addEventListener('mousedown', (event) => {
      if (event.buttons == 1 && event.button == 0) {
        rightResizeListener(event)
        this.trackListController.pointerStateManager.startResizingSelection(false)
        event.stopPropagation()
      }
    })

    this.draw()
  }

  updateRange(newLow: number, newHigh: number) {
    this.lowSample = newLow
    this.highSample = newHigh
    this.draw()
  }

  draw() {
    const highX = this.getXValueForSample(this.highSample)
    const lowX = this.getXValueForSample(this.lowSample)

    this.rect.setAttribute('x', `${lowX}`)
    this.rect.setAttribute('width', `${highX - lowX}`)

    this.leftExpand.setAttribute('x1', `${lowX}`)
    this.leftExpand.setAttribute('x2', `${lowX}`)

    this.rightExpand.setAttribute('x2', `${highX}`)
    this.rightExpand.setAttribute('x1', `${highX}`)
  }

  resize(): void {
    this.rect.setAttribute('height', `${this.waveform.fullHeight}`)
    this.leftExpand.setAttribute('y2', `${this.waveform.fullHeight}`)
    this.rightExpand.setAttribute('y2', `${this.waveform.fullHeight}`)
    this.draw()
  }
}
