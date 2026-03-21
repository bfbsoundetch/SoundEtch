import { TimeUtils } from '../../global/TimeUtils'
import { TrackListController } from './TrackListController'
import { TrackListItemController } from './TrackListItemController'

export class TimelineController extends TrackListItemController {
  private readonly TICK_MARKS = [
    new TickMarkBucket(1, 1),
    new TickMarkBucket(10, 10),
    new TickMarkBucket(100, 10),
    new TickMarkBucket(1_000, 10),
    new TickMarkBucket(5_000, 5),
    new TickMarkBucket(10_000, 10),
    new TickMarkBucket(30_000, 3),
    new TickMarkBucket(60_000, 4),
    new TickMarkBucket(5 * 60_000, 5),
    new TickMarkBucket(10 * 60_000, 10),
    new TickMarkBucket(30 * 60_000, 3),
    new TickMarkBucket(60 * 60_000, 4),
  ]

  readonly svg = document.getElementById('timeline-svg') as unknown as SVGSVGElement
  private selection: {
    lines: SVGPathElement
    leftExpand: SVGLineElement
    rightExpand: SVGLineElement
    leftLabel: SVGTextElement
    rightLabel: SVGTextElement
  } | null = null
  private width = this.svg.parentElement!.clientWidth
  private height = this.svg.parentElement!.clientHeight

  constructor(trackListController: TrackListController) {
    super(trackListController)
  }

  resize() {
    this.width = this.svg.parentElement!.clientWidth
    this.height = this.svg.parentElement!.clientHeight
    this.svg.parentElement!.setAttribute('viewBox', `0 0 ${this.width} ${this.height}`)
  }

  getWidth() {
    return this.width
  }

  getHeight() {
    return this.height
  }

  draw() {
    if (this.selection) {
      this.svg.replaceChildren(
        this.selection.lines,
        this.selection.leftExpand,
        this.selection.rightExpand,
        this.selection.leftLabel,
        this.selection.rightLabel,
      )
    } else {
      this.svg.replaceChildren()
    }

    const mainLine = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    mainLine.style.strokeWidth = '2'
    mainLine.style.stroke = 'currentColor'
    mainLine.style.fill = 'none'
    mainLine.setAttribute('x1', '0')
    mainLine.setAttribute('y1', `${this.height / 1.5}`)
    mainLine.setAttribute('x2', `${this.width}`)
    mainLine.setAttribute('y2', `${this.height / 1.5}`)

    this.svg.appendChild(mainLine)

    if (!this.msPerUnit) {
      return
    }
    const bucket = this.getTickMarkBucket()
    const increment = bucket.majorIntervalMs / this.msPerUnit
    const offset = -this.translation % (bucket.majorIntervalMs / this.msPerUnit)
    let tickMarkTime = this.getTickMarkForPosition(this.translation * this.msPerUnit, bucket)

    for (var i = 0; i < this.width - offset; i += increment) {
      const tickText = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      tickText.setAttribute('x', `${offset + i}`)
      tickText.setAttribute('y', `${this.height / 2}`)
      tickText.setAttribute('font-family', "'Courier New', Courier, monospace")
      tickText.setAttribute('font-size', '17px')
      tickText.setAttribute('dominant-baseline', 'middle')
      tickText.setAttribute('text-anchor', 'middle')
      tickText.style.stroke = 'none'
      tickText.innerHTML = TimeUtils.toString(tickMarkTime, true)
      tickMarkTime += bucket.majorIntervalMs
      this.svg.appendChild(tickText)

      const tick = document.createElementNS('http://www.w3.org/2000/svg', 'line')
      tick.style.strokeWidth = '4'
      tick.style.stroke = 'currentColor'
      tick.style.fill = 'none'
      tick.setAttribute('x1', `${offset + i}`)
      tick.setAttribute('y1', `${this.height / 1.5}`)
      tick.setAttribute('x2', `${offset + i}`)
      tick.setAttribute('y2', `${this.height}`)

      this.svg.appendChild(tick)

      for (var j = 1; j < bucket.ticksPerMajorInterval; ++j) {
        const pos = offset + i + (j * increment) / bucket.ticksPerMajorInterval

        const tick = document.createElementNS('http://www.w3.org/2000/svg', 'line')
        tick.style.strokeWidth = '2'
        tick.style.stroke = 'currentColor'
        tick.style.fill = 'none'
        tick.setAttribute('x1', `${pos}`)
        tick.setAttribute('y1', `${this.height / 1.5}`)
        tick.setAttribute('x2', `${pos}`)
        tick.setAttribute('y2', `${this.height / 1.25}`)

        this.svg.appendChild(tick)
      }
    }
  }

  drawSelection(lowSample: number, highSample: number) {
    if (!this.selection) {
      this.selection = {
        lines: document.createElementNS('http://www.w3.org/2000/svg', 'path'),
        leftExpand: document.createElementNS('http://www.w3.org/2000/svg', 'line'),
        rightExpand: document.createElementNS('http://www.w3.org/2000/svg', 'line'),
        leftLabel: document.createElementNS('http://www.w3.org/2000/svg', 'text'),
        rightLabel: document.createElementNS('http://www.w3.org/2000/svg', 'text'),
      }

      this.selection.lines.style.strokeWidth = '2'

      this.selection.leftExpand.style.cursor = 'ew-resize'
      this.selection.leftExpand.style.userSelect = 'none'
      this.selection.leftExpand.style.strokeWidth = '10'
      this.selection.leftExpand.style.strokeOpacity = '0'
      this.selection.leftExpand.setAttribute('y1', '30')
      this.selection.leftExpand.setAttribute('y2', `${this.height}`)

      this.selection.rightExpand.style.cursor = 'ew-resize'
      this.selection.rightExpand.style.userSelect = 'none'
      this.selection.rightExpand.style.strokeWidth = '10'
      this.selection.rightExpand.style.strokeOpacity = '0'
      this.selection.rightExpand.setAttribute('y1', '30')
      this.selection.rightExpand.setAttribute('y2', `${this.height}`)

      this.selection.leftLabel.innerHTML = TimeUtils.positionToString(
        lowSample,
        this.trackListController.sampleRate,
        false,
      )
      this.selection.leftLabel.setAttribute('y', '15')
      this.selection.leftLabel.style.stroke = 'none'
      this.selection.leftLabel.style.dominantBaseline = 'middle'
      this.selection.leftLabel.style.textAnchor = 'middle'
      this.selection.leftLabel.style.fontFamily = "'Courier New', Courier, monospace"
      this.selection.leftLabel.style.fontSize = '18px'
      this.selection.leftLabel.style.fontWeight = 'bold'

      this.selection.rightLabel.innerHTML = TimeUtils.positionToString(
        highSample,
        this.trackListController.sampleRate,
        false,
      )
      this.selection.rightLabel.setAttribute('y', '15')
      this.selection.rightLabel.style.stroke = 'none'
      this.selection.rightLabel.style.dominantBaseline = 'middle'
      this.selection.rightLabel.style.textAnchor = 'middle'
      this.selection.rightLabel.style.fontFamily = "'Courier New', Courier, monospace"
      this.selection.rightLabel.style.fontSize = '18px'
      this.selection.rightLabel.style.fontWeight = 'bold'

      this.selection.leftExpand.addEventListener('mousedown', (event) => {
        if (event.buttons == 1 && event.button == 0) {
          this.trackListController.pointerStateManager.startResizingSelection(true)
          event.stopPropagation()
        }
      })

      this.selection.rightExpand.addEventListener('mousedown', (event) => {
        if (event.buttons == 1 && event.button == 0) {
          this.trackListController.pointerStateManager.startResizingSelection(false)
          event.stopPropagation()
        }
      })

      this.svg.append(
        this.selection.lines,
        this.selection.leftExpand,
        this.selection.rightExpand,
        this.selection.leftLabel,
        this.selection.rightLabel,
      )
    }
    const startX = this.getXValueForSample(lowSample)
    const endX = this.getXValueForSample(highSample)
    this.selection.lines.setAttribute(
      'd',
      `M ${startX} 30 L ${startX} ${this.height} M ${endX} 30 L ${endX} ${this.height}`,
    )
    this.selection.leftExpand.setAttribute('x1', `${startX}`)
    this.selection.leftExpand.setAttribute('x2', `${startX}`)
    this.selection.rightExpand.setAttribute('x1', `${endX}`)
    this.selection.rightExpand.setAttribute('x2', `${endX}`)

    const labelPush = Math.max(0, Number(this.selection.leftLabel.style.width) - (endX - startX)) / 2

    this.selection.leftLabel.setAttribute('x', `${startX - labelPush}`)
    this.selection.rightLabel.setAttribute('x', `${endX + labelPush}`)

    this.selection.leftLabel.innerHTML = TimeUtils.positionToString(
      lowSample,
      this.trackListController.sampleRate,
      true,
    )
    this.selection.rightLabel.innerHTML = TimeUtils.positionToString(
      highSample,
      this.trackListController.sampleRate,
      true,
    )
  }

  removeSelection() {
    this.selection?.lines.remove()
    this.selection?.leftExpand.remove()
    this.selection?.rightExpand.remove()
    this.selection?.leftLabel.remove()
    this.selection?.rightLabel.remove()

    this.selection = null
  }

  private getTickMarkBucket(): TickMarkBucket {
    return (
      this.TICK_MARKS.findLast((bucket) => bucket.majorIntervalMs / this.msPerUnit < 1000) ??
      this.TICK_MARKS[this.TICK_MARKS.length - 1]
    )
  }

  private getTickMarkForPosition(position: number, bucket: TickMarkBucket): number {
    return Math.floor(position / bucket.majorIntervalMs) * bucket.majorIntervalMs
  }
}

class TickMarkBucket {
  constructor(
    readonly majorIntervalMs: number,
    readonly ticksPerMajorInterval: number,
  ) {}
}
