import { Analyzable } from 'analyzers/Analyzable'

export class PeakMeterController {
  private static SHORT = 50
  private static LONG = 250
  private static OFFSET = 10

  readonly svg: SVGSVGElement
  private readonly levelRect: SVGRectElement
  private readonly peakRect: SVGRectElement
  private readonly peakLine: SVGLineElement
  private stopped = false

  constructor(
    parentDiv: HTMLDivElement,
    private analyzable: Analyzable,
    private readonly horizontal: boolean = false,
    private max: number = 6,
    private min: number = -90,
    showScale = false,
  ) {
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    parentDiv.appendChild(this.svg)
    this.svg.setAttribute(
      'viewBox',
      this.horizontal
        ? `0 0 ${PeakMeterController.LONG} ${PeakMeterController.SHORT}`
        : `0 0 ${PeakMeterController.SHORT} ${PeakMeterController.LONG}`,
    )
    this.svg.style.aspectRatio = this.horizontal ? '5' : '1/5'
    this.svg.style.transform = this.horizontal ? 'scale(-1,1)' : ''

    if (showScale) {
      this.drawScale()
    }

    const zeroLine = document.createElementNS('http://www.w3.org/2000/svg', 'line') as unknown as SVGLineElement
    this.svg.appendChild(zeroLine)
    const linePosition = this.position(0)
    zeroLine.setAttribute(this.horizontal ? 'x1' : 'y1', `${linePosition}`)
    zeroLine.setAttribute(this.horizontal ? 'x2' : 'y2', `${linePosition}`)
    zeroLine.setAttribute(this.horizontal ? 'y1' : 'x1', `${PeakMeterController.SHORT / 2}`)
    zeroLine.setAttribute(this.horizontal ? 'y2' : 'x2', `${PeakMeterController.SHORT}`)
    zeroLine.style.stroke = 'currentColor'
    zeroLine.style.strokeWidth = '1'

    this.peakRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    this.peakRect.setAttribute(this.horizontal ? 'height' : 'width', `${PeakMeterController.SHORT / 2}`)
    this.peakRect.setAttribute(
      this.horizontal ? 'width' : 'height',
      `${PeakMeterController.LONG - 2 * PeakMeterController.OFFSET}`,
    )
    this.peakRect.classList.add('peakRect')
    this.peakRect.style.color = 'rgba(255,255,255,.5)'
    this.peakRect.setAttribute(this.horizontal ? 'y' : 'x', `${PeakMeterController.SHORT / 2}`)
    this.peakRect.setAttribute(this.horizontal ? 'x' : 'y', `${PeakMeterController.OFFSET}`)
    this.peakRect.style.transform = `translate${this.horizontal ? 'X' : 'Y'}(100%)`
    this.peakRect.style.transition = 'transform 90ms'
    this.svg.appendChild(this.peakRect)

    this.levelRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    this.levelRect.setAttribute(this.horizontal ? 'height' : 'width', `${PeakMeterController.SHORT / 2}`)
    this.levelRect.setAttribute(
      this.horizontal ? 'width' : 'height',
      `${PeakMeterController.LONG - 2 * PeakMeterController.OFFSET}`,
    )
    this.levelRect.classList.add('levelRect')
    this.levelRect.setAttribute(this.horizontal ? 'y' : 'x', `${PeakMeterController.SHORT / 2}`)
    this.levelRect.setAttribute(this.horizontal ? 'x' : 'y', `${PeakMeterController.OFFSET}`)
    this.levelRect.style.transform = `translate${this.horizontal ? 'X' : 'Y'}(100%)`
    this.levelRect.style.transition = 'transform 90ms'
    this.svg.appendChild(this.levelRect)

    this.peakLine = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    this.peakLine.setAttribute(this.horizontal ? 'x1' : 'y1', `${PeakMeterController.OFFSET}`)
    this.peakLine.setAttribute(this.horizontal ? 'x2' : 'y2', `${PeakMeterController.OFFSET}`)
    this.peakLine.setAttribute(this.horizontal ? 'y1' : 'x1', `${PeakMeterController.SHORT / 2}`)
    this.peakLine.setAttribute(this.horizontal ? 'y2' : 'x2', `${PeakMeterController.SHORT}`)
    this.peakLine.classList.add('peakLine')
    this.peakLine.style.transform = `translate${this.horizontal ? 'X' : 'Y'}(100%)`
    this.svg.appendChild(this.peakLine)
  }

  drawScale() {
    const zeroLine = document.createElementNS('http://www.w3.org/2000/svg', 'line') as unknown as SVGLineElement
    this.svg.appendChild(zeroLine)
    const linePosition = this.position(0)
    zeroLine.setAttribute(this.horizontal ? 'x1' : 'y1', `${linePosition}`)
    zeroLine.setAttribute(this.horizontal ? 'x2' : 'y2', `${linePosition}`)
    zeroLine.setAttribute(this.horizontal ? 'y1' : 'x1', `${PeakMeterController.SHORT / 2}`)
    zeroLine.setAttribute(this.horizontal ? 'y2' : 'x2', `${PeakMeterController.SHORT}`)
    zeroLine.style.stroke = 'currentColor'
    zeroLine.style.strokeWidth = '1'
    ;[-90, -70, -50, -30, -10, 0, 6].forEach((n) => {
      const position = this.position(n)

      const textElement = document.createElementNS('http://www.w3.org/2000/svg', 'text') as unknown as SVGLineElement
      this.svg.appendChild(textElement)
      textElement.setAttribute(this.horizontal ? 'x' : 'y', `${position}`)
      textElement.style.transform = this.horizontal ? 'scale(-1,1)' : ''
      textElement.style.transformOrigin = this.horizontal ? 'center' : ''
      textElement.style.transformBox = 'content-box'
      textElement.setAttribute(this.horizontal ? 'y' : 'x', `${PeakMeterController.SHORT / 4}`)
      textElement.textContent = `${n}`
      textElement.style.fontSize = '10'
      textElement.style.dominantBaseline = 'middle'
      textElement.style.textAnchor = 'middle'
      textElement.style.fontFamily = "'Courier New', Courier, monospace"

      const lineElement = document.createElementNS('http://www.w3.org/2000/svg', 'line') as unknown as SVGLineElement
      this.svg.appendChild(lineElement)
      lineElement.setAttribute(this.horizontal ? 'x1' : 'y1', `${position}`)
      lineElement.setAttribute(this.horizontal ? 'x2' : 'y2', `${position}`)
      lineElement.setAttribute(this.horizontal ? 'y1' : 'x1', `${(7 * PeakMeterController.SHORT) / 16}`)
      lineElement.setAttribute(this.horizontal ? 'y2' : 'x2', `${PeakMeterController.SHORT / 2}`)
    })
  }

  draw(self: PeakMeterController) {
    if (this.stopped) {
      return
    }
    const level = self.analyzable.getLevel()
    const peak = self.analyzable.getPeak()
    const heldPeak = self.analyzable.getHeldPeak()

    const levelScale = this.scaledValue(level)
    this.levelRect.style.transform = `translate${this.horizontal ? 'X' : 'Y'}(${(1 - levelScale) * 100}%)`
    const peakScale = this.scaledValue(peak)
    this.peakRect.style.transform = `translate${this.horizontal ? 'X' : 'Y'}(${(1 - peakScale) * 100}%)`
    this.peakRect.style.color = peak > 0.0 ? 'rgba(255,0,0,.5)' : 'rgba(255,255,255,.5)'
    this.peakLine.style.color = heldPeak > 0.0 ? 'rgb(255,0,0)' : 'rgb(255,255,255)'
    const heldPeakScale = this.scaledValue(heldPeak)
    this.peakLine.style.transform = `translate${this.horizontal ? 'X' : 'Y'}(${(1 - heldPeakScale) * 100}%)`
    requestAnimationFrame((_) => self.draw(self))
  }

  stop() {
    this.stopped = true
  }

  remove() {
    this.svg.remove()
  }

  private scaledValue(n: number) {
    if (n === Number.NEGATIVE_INFINITY) {
      return 0
    }
    return (n - this.min) / (this.max - this.min)
  }

  private position(n: number) {
    return (
      PeakMeterController.OFFSET +
      (1 - this.scaledValue(n)) * (PeakMeterController.LONG - 2 * PeakMeterController.OFFSET)
    )
  }
}
