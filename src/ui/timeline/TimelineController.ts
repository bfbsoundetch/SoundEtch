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

  private rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize)
  readonly svg = document.getElementById('timeline-svg') as unknown as SVGSVGElement
  private readonly majorTicks = document.getElementById('timeline-major-ticks') as unknown as SVGPathElement
  private readonly minorTicks = document.getElementById('timeline-minor-ticks') as unknown as SVGPathElement
  private readonly tickLabels = new Array<SVGTextElement>()

  private selection: {
    lines: SVGPathElement
    leftExpand: SVGLineElement
    rightExpand: SVGLineElement
    leftLabel: SVGTextElement
    rightLabel: SVGTextElement
  } | null = null
  private width = this.svg.parentElement!.clientWidth
  private height = this.svg.parentElement!.clientHeight

  private readonly mainLine = document.createElementNS('http://www.w3.org/2000/svg', 'line')


  constructor(trackListController: TrackListController) {
    super(trackListController)

    this.mainLine.style.strokeWidth = '2'
    this.mainLine.style.stroke = 'currentColor'
    this.mainLine.style.fill = 'none'
    this.mainLine.setAttribute('x1', '0')
    this.mainLine.setAttribute('y1', `${this.height / 1.5}`)
    this.mainLine.setAttribute('x2', `${this.width}`)
    this.mainLine.setAttribute('y2', `${this.height / 1.5}`)

    this.svg.appendChild(this.mainLine)
  }

  resize() {
    this.width = this.svg.parentElement!.clientWidth
    this.height = this.svg.parentElement!.clientHeight
    this.mainLine.setAttribute('x2', `${this.width}`)
    this.svg.parentElement!.setAttribute('viewBox', `0 0 ${this.width} ${this.height}`)
    this.rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize)
  }

  getWidth() {
    return this.width
  }

  getHeight() {
    return this.height
  }

  draw() {
    if (!this.msPerUnit) {
      return
    }
    const bucket = this.getTickMarkBucket()
    const increment = bucket.majorIntervalMs / this.msPerUnit

    const timelineOffset = 14 * this.rootFontSize // width of 'info' column
    const offset = (timelineOffset - this.translation) % increment
    const timelineOffsetTicks = Math.ceil(offset / increment)
    const tickMarkTime = this.getTickMarkForPosition(this.translation * this.msPerUnit, bucket)

    const majorTickPathParts = new Array<string>()
    const minorTickPathParts = new Array<string>()

    let textIndex = 0
    for (var i = -timelineOffsetTicks; i < (this.width - offset) / increment; ++i) {
      let tickText: SVGTextElement
      textIndex = i + timelineOffsetTicks
      if (textIndex < this.tickLabels.length) {
        tickText = this.tickLabels[textIndex]
      } else {
        tickText = document.createElementNS('http://www.w3.org/2000/svg', 'text')
        tickText.setAttribute('y', `${this.height / 2}`)
        tickText.style.fontFamily = "'Courier New', Courier, monospace"
        tickText.style.fontSize = '17px'
        tickText.style.dominantBaseline = 'middle'
        tickText.style.textAnchor = 'middle'
        tickText.style.stroke = 'none'
        this.svg.appendChild(tickText)
        this.tickLabels.push(tickText)
      }
      const x = offset + i * increment
      tickText.setAttribute('x', `${x}`)
      tickText.style.visibility = 'visible'
      tickText.innerHTML = TimeUtils.toString(tickMarkTime + i * bucket.majorIntervalMs, true)

      majorTickPathParts.push(`M ${x} ${this.height / 1.5} L ${x} ${this.height}`)

      for (var j = 1; j < bucket.ticksPerMajorInterval; ++j) {
        const pos = x + (j * increment) / bucket.ticksPerMajorInterval
        minorTickPathParts.push(`M ${pos} ${this.height / 1.5} L ${pos} ${this.height / 1.25}`)
      }
    }

    while (++textIndex < this.tickLabels.length && this.tickLabels[textIndex].style.visibility == 'visible') {
      this.tickLabels[textIndex].style.visibility = 'hidden'
    }
    this.majorTicks.setAttribute('d', majorTickPathParts.join(' '))
    this.minorTicks.setAttribute('d', minorTickPathParts.join(' '))
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

      this.selection.leftLabel.setAttribute('y', '15')
      this.selection.leftLabel.style.stroke = 'none'
      this.selection.leftLabel.style.dominantBaseline = 'middle'
      this.selection.leftLabel.style.textAnchor = 'middle'
      this.selection.leftLabel.style.fontFamily = "'Courier New', Courier, monospace"
      this.selection.leftLabel.style.fontSize = '18px'
      this.selection.leftLabel.style.fontWeight = 'bold'

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
    const startX = this.getXValueForSample(lowSample) + 14 * this.rootFontSize
    const endX = this.getXValueForSample(highSample) + 14 * this.rootFontSize
    this.selection.lines.setAttribute(
      'd',
      `M ${startX} 30 L ${startX} ${this.height} M ${endX} 30 L ${endX} ${this.height}`,
    )
    this.selection.leftExpand.setAttribute('x1', `${startX}`)
    this.selection.leftExpand.setAttribute('x2', `${startX}`)
    this.selection.rightExpand.setAttribute('x1', `${endX}`)
    this.selection.rightExpand.setAttribute('x2', `${endX}`)

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

    const labelPush = Math.max(0, 
      (Number(this.selection.rightLabel.getBoundingClientRect().width) + 
      Number(this.selection.leftLabel.getBoundingClientRect().width)) * 
      1.1 / 2 - (endX - startX)) / 2

    this.selection.leftLabel.setAttribute('x', `${startX - labelPush}`)
    this.selection.rightLabel.setAttribute('x', `${endX + labelPush}`)
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
