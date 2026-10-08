import { TimeUtils } from '../../global/TimeUtils'
import { TimelineRegionController } from './TimelineRegionController'
import { TrackListController } from './TrackListController'
import { TrackListItemController } from './TrackListItemController'

export class TimelineController extends TrackListItemController {
  private readonly LABEL_FONT_SIZE = 17
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
    new TickMarkBucket(120 * 60_000, 4),
  ]

  readonly svg = document.getElementById('timeline-svg') as unknown as SVGSVGElement
  private readonly majorTicks = document.getElementById('timeline-major-ticks') as unknown as SVGPathElement
  private readonly minorTicks = document.getElementById('timeline-minor-ticks') as unknown as SVGPathElement
  private readonly tickLabels = new Array<SVGTextElement>()

  private selectionElements: {
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
    const bucket = this.getTickMarkBucket(this.LABEL_FONT_SIZE * 0.6 * 14)
    const increment = bucket.majorIntervalMs / this.msPerUnit

    const timelineOffset = 14 * this.trackListController.rootFontSize // width of 'info' column
    const offset = timelineOffset - (this.translation % increment)
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
        tickText.style.fontSize = this.LABEL_FONT_SIZE + 'px'
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
    if (!this.selectionElements) {
      this.selectionElements = {
        lines: document.createElementNS('http://www.w3.org/2000/svg', 'path'),
        leftExpand: document.createElementNS('http://www.w3.org/2000/svg', 'line'),
        rightExpand: document.createElementNS('http://www.w3.org/2000/svg', 'line'),
        leftLabel: document.createElementNS('http://www.w3.org/2000/svg', 'text'),
        rightLabel: document.createElementNS('http://www.w3.org/2000/svg', 'text'),
      }

      this.selectionElements.lines.style.strokeWidth = '2'

      this.selectionElements.leftExpand.style.cursor = 'ew-resize'
      this.selectionElements.leftExpand.style.userSelect = 'none'
      this.selectionElements.leftExpand.style.strokeWidth = '10'
      this.selectionElements.leftExpand.style.strokeOpacity = '0'
      this.selectionElements.leftExpand.setAttribute('y1', '30')
      this.selectionElements.leftExpand.setAttribute('y2', `${this.height}`)

      this.selectionElements.rightExpand.style.cursor = 'ew-resize'
      this.selectionElements.rightExpand.style.userSelect = 'none'
      this.selectionElements.rightExpand.style.strokeWidth = '10'
      this.selectionElements.rightExpand.style.strokeOpacity = '0'
      this.selectionElements.rightExpand.setAttribute('y1', '30')
      this.selectionElements.rightExpand.setAttribute('y2', `${this.height}`)

      this.selectionElements.leftLabel.setAttribute('y', '15')
      this.selectionElements.leftLabel.style.stroke = 'none'
      this.selectionElements.leftLabel.style.dominantBaseline = 'middle'
      this.selectionElements.leftLabel.style.textAnchor = 'middle'
      this.selectionElements.leftLabel.style.fontFamily = "'Courier New', Courier, monospace"
      this.selectionElements.leftLabel.style.fontSize = '18px'
      this.selectionElements.leftLabel.style.fontWeight = 'bold'

      this.selectionElements.rightLabel.setAttribute('y', '15')
      this.selectionElements.rightLabel.style.stroke = 'none'
      this.selectionElements.rightLabel.style.dominantBaseline = 'middle'
      this.selectionElements.rightLabel.style.textAnchor = 'middle'
      this.selectionElements.rightLabel.style.fontFamily = "'Courier New', Courier, monospace"
      this.selectionElements.rightLabel.style.fontSize = '18px'
      this.selectionElements.rightLabel.style.fontWeight = 'bold'

      this.selectionElements.leftExpand.addEventListener('mousedown', (event) => {
        if (event.buttons == 1 && event.button == 0) {
          this.trackListController.selectionController.updateSelectionStartSample(true)
          this.trackListController.pointerStateManager.startResizingSelection(
            this.trackListController.selectionController,
          )
          event.stopPropagation()
        }
      })

      this.selectionElements.rightExpand.addEventListener('mousedown', (event) => {
        if (event.buttons == 1 && event.button == 0) {
          this.trackListController.selectionController.updateSelectionStartSample(false)
          this.trackListController.pointerStateManager.startResizingSelection(
            this.trackListController.selectionController,
          )
          event.stopPropagation()
        }
      })

      this.svg.append(
        this.selectionElements.lines,
        this.selectionElements.leftExpand,
        this.selectionElements.rightExpand,
        this.selectionElements.leftLabel,
        this.selectionElements.rightLabel,
      )
    }
    const startX = this.getXValueForSample(lowSample) + 14 * this.trackListController.rootFontSize
    const endX = this.getXValueForSample(highSample) + 14 * this.trackListController.rootFontSize
    this.selectionElements.lines.setAttribute(
      'd',
      `M ${startX} 30 L ${startX} ${this.height} M ${endX} 30 L ${endX} ${this.height}`,
    )
    this.selectionElements.leftExpand.setAttribute('x1', `${startX}`)
    this.selectionElements.leftExpand.setAttribute('x2', `${startX}`)
    this.selectionElements.rightExpand.setAttribute('x1', `${endX}`)
    this.selectionElements.rightExpand.setAttribute('x2', `${endX}`)

    this.selectionElements.leftLabel.innerHTML = TimeUtils.positionToString(
      lowSample,
      this.trackListController.sampleRate,
      true,
    )
    this.selectionElements.rightLabel.innerHTML = TimeUtils.positionToString(
      highSample,
      this.trackListController.sampleRate,
      true,
    )

    const labelPush =
      Math.max(
        0,
        ((Number(this.selectionElements.rightLabel.getBoundingClientRect().width) +
          Number(this.selectionElements.leftLabel.getBoundingClientRect().width)) *
          1.1) /
          2 -
          (endX - startX),
      ) / 2

    this.selectionElements.leftLabel.setAttribute('x', `${startX - labelPush}`)
    this.selectionElements.rightLabel.setAttribute('x', `${endX + labelPush}`)

    if (
      this.svg.checkIntersection(
        this.selectionElements.rightLabel,
        this.trackListController.positionMarkerController.getLabelBoundingBox(),
      )
    ) {
      this.selectionElements.rightLabel.style.opacity = '.2'
    } else {
      this.selectionElements.rightLabel.style.opacity = '1'
    }

    if (
      this.svg.checkIntersection(
        this.selectionElements.leftLabel,
        this.trackListController.positionMarkerController.getLabelBoundingBox(),
      )
    ) {
      this.selectionElements.leftLabel.style.opacity = '.2'
    } else {
      this.selectionElements.leftLabel.style.opacity = '1'
    }
  }

  removeSelection() {
    this.selectionElements?.lines.remove()
    this.selectionElements?.leftExpand.remove()
    this.selectionElements?.rightExpand.remove()
    this.selectionElements?.leftLabel.remove()
    this.selectionElements?.rightLabel.remove()

    this.selectionElements = null
  }

  private getTickMarkBucket(labelWidth: number): TickMarkBucket {
    return (
      this.TICK_MARKS.find((bucket) => labelWidth && bucket.majorIntervalMs / this.msPerUnit > labelWidth) ??
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
