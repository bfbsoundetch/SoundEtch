import { Track } from '../../project/Track'
import { ClipView, cloneClipViewWithNewStartPosition } from '../../project/ClipView'
import { AudioControl, AudioState } from '../../audiocontext/AudioControl'
import { TrackListItemController } from './TrackListItemController'
import { TrackListController } from './TrackListController'
import { ContextMenuController, ContextMenuItem } from '../../ui/ContextMenuController'
import { ProjectManager } from '../../project/ProjectManager'
import { SummaryGenerator } from '../../project/SummaryGenerator'

/** Handles displaying a track's waveform. */
export class Waveform extends TrackListItemController {
  static readonly HEADER_HEIGHT = 20
  private readonly PIXEL_RATIO = window.devicePixelRatio || 1

  topSvgElement: SVGSVGElement
  private selection: {
    rect: SVGRectElement
    leftExpand: SVGLineElement
    rightExpand: SVGLineElement
  } | null = null

  private readonly clipViewControllerMap = new Map<ClipView, ClipViewController>()
  private readonly color: string
  width = 0
  private height = 0

  getHeight() {
    return this.height
  }

  drawSelection(lowSample: number, highSample: number) {
    const highX = this.getXValueForSample(highSample)
    if (highX < this.translation) {
      this.removeSelection()
    }
    const lowX = this.getXValueForSample(lowSample)
    if (!this.selection) {
      this.selection = {
        rect: document.createElementNS('http://www.w3.org/2000/svg', 'rect'),
        leftExpand: document.createElementNS('http://www.w3.org/2000/svg', 'line'),
        rightExpand: document.createElementNS('http://www.w3.org/2000/svg', 'line'),
      }

      this.selection.rect.setAttribute('y', '0')
      this.selection.rect.setAttribute('height', `${this.height + Waveform.HEADER_HEIGHT}`)
      this.selection.rect.setAttribute('x', `${lowX}`)
      this.selection.rect.classList = 'waveform-selection'
      this.selection.rect.addEventListener('mousedown', (event) => {
        event.stopPropagation()
      })
      this.selection.rect.addEventListener('contextmenu', (event) => {
        event.preventDefault()
        this.trackListController.timelineSelectionContextMenu.draw(event.clientX, event.clientY)
      })

      this.selection.leftExpand.style.cursor = 'col-resize'
      this.selection.leftExpand.style.strokeWidth = '10'
      this.selection.leftExpand.style.strokeOpacity = '0'
      this.selection.leftExpand.setAttribute('y1', '0')
      this.selection.leftExpand.setAttribute('y2', `${this.getHeight()}`)

      this.selection.rightExpand.style.cursor = 'col-resize'
      this.selection.rightExpand.style.strokeWidth = '10'
      this.selection.rightExpand.style.strokeOpacity = '0'
      this.selection.rightExpand.setAttribute('y1', '0')
      this.selection.rightExpand.setAttribute('y2', `${this.getHeight()}`)

      this.selection.leftExpand.addEventListener('mousedown', (event) => {
        if (event.buttons == 1 && event.button == 0) {
          this.trackListController.updateSelectionStartSample(true)
          event.stopPropagation()
        }
      })

      this.selection.rightExpand.addEventListener('mousedown', (event) => {
        if (event.buttons == 1 && event.button == 0) {
          this.trackListController.updateSelectionStartSample(false)
          event.stopPropagation()
        }
      })

      this.topSvgElement.appendChild(this.selection.rect)
      this.topSvgElement.appendChild(this.selection.leftExpand)
      this.topSvgElement.appendChild(this.selection.rightExpand)
    }

    this.selection.rect.setAttribute('x', `${lowX}`)
    this.selection.rect.setAttribute('width', `${highX - lowX}`)

    this.selection.leftExpand.setAttribute('x1', `${lowX}`)
    this.selection.leftExpand.setAttribute('x2', `${lowX}`)

    this.selection.rightExpand.setAttribute('x2', `${highX}`)
    this.selection.rightExpand.setAttribute('x1', `${highX}`)
  }

  removeSelection() {
    this.selection?.rect.remove()
    this.selection?.leftExpand.remove()
    this.selection?.rightExpand.remove()
    this.selection = null
  }

  /**
   * @param {Track} track The track to display.
   * @param {string} div The `div` that will hold the waveform.
   */
  constructor(
    trackListController: TrackListController,
    readonly track: Track,
    private readonly div: HTMLDivElement,
    readonly index: number,
  ) {
    super(trackListController)
    this.color = `var(--waveform-${index})`
    div.classList = 'waveform tracklist-item'
    div.addEventListener('dblclick', (event) => {
      trackListController.selectTrack(this)
    })
    AudioControl.addAudioControlListener((state) => {
      switch (state) {
        case AudioState.RECORDING:
          const topSvgElement = this.getTopSvgElement()
          this.drawAudioDataForCanvasXRange(this, topSvgElement, 0, this.width)
          break
      }
    })
    this.topSvgElement = this.getTopSvgElement()
    this.topSvgElement.addEventListener('mouseenter', (mouseEvent) => {
      this.trackListController.pointerStateManager.setPointedOverTrack(this)
    })
    this.topSvgElement.addEventListener('mouseleave', (mouseEvent) => {
      this.trackListController.pointerStateManager.removePointedOverTrack(this)
    })
  }

  private getTopSvgElement(): SVGSVGElement {
    if (this.topSvgElement == null) {
      this.topSvgElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      this.topSvgElement.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
      this.topSvgElement.id = `waveform-parent-${this.track.id}`
      this.topSvgElement.style.height = '100%'
      this.topSvgElement.style.width = '100%'
      this.topSvgElement.style.display = 'block'
      this.div.appendChild(this.topSvgElement)
    }
    this.topSvgElement.setAttribute('viewBox', `0 0 ${this.width} ${this.height + Waveform.HEADER_HEIGHT}`)

    return this.topSvgElement
  }

  /**
   * Draws the waveform.
   */
  draw() {
    const topSvgElement = this.getTopSvgElement()

    this.drawAudioDataForCanvasXRange(this, topSvgElement, 0, this.width)
    this.drawAxes(topSvgElement)
  }

  resize() {
    this.width = this.div.clientWidth
    this.height = this.div.clientHeight - Waveform.HEADER_HEIGHT
    this.topSvgElement.setAttribute('viewBox', `0 0 ${this.width} ${this.height + Waveform.HEADER_HEIGHT}`)
  }

  private drawAxes(topSvgElement: SVGSVGElement) {
    const id = `waveform-axes-${this.track.id}`

    let svgPathElement: SVGPathElement | null = document.getElementById(id) as unknown as SVGPathElement
    if (!svgPathElement) {
      svgPathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      svgPathElement.id = id
      svgPathElement.style.strokeWidth = '2'
      svgPathElement.style.stroke = 'currentColor'
      svgPathElement.style.fill = 'none'
      topSvgElement.appendChild(svgPathElement)
    }

    const axesPath = `M 1 0 L 1 ${this.height + Waveform.HEADER_HEIGHT} M 0 ${Waveform.HEADER_HEIGHT + this.height / 2} L ${this.width * this.PIXEL_RATIO} ${Waveform.HEADER_HEIGHT + this.height / 2}`

    svgPathElement.setAttribute('d', axesPath)
  }

  async removeClipView(clipViewIndex: number) {
    const clipView = this.track.clipViews[clipViewIndex]
    this.track.removeClipView(clipViewIndex)
    this.removeClipViewController(this.clipViewControllerMap.get(clipView)!)
  }

  async replaceClipView(clipViewIndex: number, newClipView: ClipView) {
    const clipView = this.track.clipViews[clipViewIndex]
    const old = this.clipViewControllerMap.get(clipView)
    this.clipViewControllerMap.delete(clipView)
    const replacePromise = this.track.replaceClipView(clipViewIndex, newClipView)
    old?.remove()
    this.draw()
    await replacePromise
  }

  removeClipViewController(controller: ClipViewController) {
    controller.remove()
    this.clipViewControllerMap.delete(this.track.clipViews[controller.clipViewIndex])
  }

  private async drawAudioDataForCanvasXRange(
    waveform: Waveform,
    topSvgElement: SVGSVGElement,
    start: number,
    end: number,
  ) {
    const startSample = waveform.getSampleForXValue(start)
    let sample = waveform.getSampleForXValue(start)
    const endSample = waveform.getSampleForXValue(end)
    for (let clipViewIndex = 0; clipViewIndex < waveform.track.clipViews.length; ++clipViewIndex) {
      const currentClipView = waveform.track.clipViews[clipViewIndex]
      let clipViewController = this.clipViewControllerMap.get(currentClipView)
      if (
        currentClipView.startPosition < endSample &&
        currentClipView.startPosition + currentClipView.length > startSample &&
        sample < endSample
      ) {
        if (!clipViewController) {
          clipViewController = new ClipViewController(
            this.trackListController,
            currentClipView,
            this,
            clipViewIndex,
            this.color,
          )
          this.clipViewControllerMap.set(currentClipView, clipViewController)
        }
        clipViewController.draw(startSample, endSample)
      } else if (clipViewController) {
        this.removeClipViewController(clipViewController)
      }

      sample = currentClipView.getEndPosition()
    }

    if (AudioControl.getState() == AudioState.RECORDING) {
      requestAnimationFrame(() => waveform.drawAudioDataForCanvasXRange(waveform, topSvgElement, start, end))
    }
  }

  drawClipViewOver(clipViewController: ClipViewController) {
    if (this.topSvgElement == (clipViewController.rectElement.parentElement as any)) {
      return
    }
    clipViewController.rectElement.remove()
    clipViewController.leftHandle.remove()
    clipViewController.rightHandle.remove()
    clipViewController.svgPathElement.remove()
    clipViewController.headerElement.remove()
    clipViewController.headerTitleElement.remove()
    this.topSvgElement.appendChild(clipViewController.rectElement)
    this.topSvgElement.appendChild(clipViewController.leftHandle)
    this.topSvgElement.appendChild(clipViewController.rightHandle)
    this.topSvgElement.appendChild(clipViewController.svgPathElement)
    this.topSvgElement.appendChild(clipViewController.headerElement)
    this.topSvgElement.appendChild(clipViewController.headerTitleElement)
  }
}

export class ClipViewController extends TrackListItemController {
  readonly rectElement = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  readonly headerElement = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  readonly headerTitleElement = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject')
  readonly svgPathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path') as unknown as SVGPathElement
  readonly leftHandle = document.createElementNS('http://www.w3.org/2000/svg', 'line') as unknown as SVGLineElement
  readonly rightHandle = document.createElementNS('http://www.w3.org/2000/svg', 'line') as unknown as SVGLineElement
  private readonly fullClipGrayFilter = document.createElementNS('http://www.w3.org/2000/svg', 'rect')

  private readonly waveformContextMenu: ContextMenuController
  private readonly waveformHeight: number
  private pathElementTranslation = 0
  private resizeInfo: {
    side: 'left' | 'right'
    oldStartX: number
    oldWidth: number
    fullClipStartX: number
    fullClipEndX: number
  } | null = null

  constructor(
    readonly trackListController: TrackListController,
    readonly clipView: ClipView,
    readonly waveform: Waveform,
    readonly clipViewIndex: number,
    color: string,
  ) {
    super(trackListController)
    this.waveformHeight = this.waveform.getHeight()

    const headerTitleDivElement = document.createElement('div')
    headerTitleDivElement.innerText = this.clipView.clip.name
    this.headerTitleElement.appendChild(headerTitleDivElement)
    headerTitleDivElement.style.overflow = 'hidden'
    headerTitleDivElement.style.textOverflow = 'clip'
    headerTitleDivElement.style.whiteSpace = 'nowrap'
    headerTitleDivElement.style.color = 'var(--waveform-header-text)'

    this.waveform.topSvgElement.appendChild(this.rectElement)
    this.waveform.topSvgElement.appendChild(this.headerElement)
    this.waveform.topSvgElement.appendChild(this.headerTitleElement)
    this.waveform.topSvgElement.appendChild(this.fullClipGrayFilter)
    this.rectElement.setAttribute('y', `${Waveform.HEADER_HEIGHT}`)
    this.rectElement.setAttribute('height', `${this.waveformHeight}`)
    this.rectElement.classList = 'waveform-rect'
    this.rectElement.style.fill = color
    this.rectElement.addEventListener('dblclick', (event) => {
      event.stopPropagation()
      trackListController.setSelection(clipView.startPosition, clipView.getEndPosition(), new Set([this.waveform]))
    })

    this.rectElement.setAttribute('x', '0')

    this.headerElement.setAttribute('y', '0')
    this.headerElement.height.baseVal.value = Waveform.HEADER_HEIGHT
    this.headerElement.style.fill = 'var(--waveform-header-bg)'
    this.headerElement.style.strokeWidth = '2'
    this.headerTitleElement.y.baseVal.value = 0
    this.headerTitleElement.height.baseVal.value = Waveform.HEADER_HEIGHT
    this.headerTitleElement.style.fill = 'none'

    this.waveform.topSvgElement.appendChild(this.leftHandle)
    this.leftHandle.setAttribute('y1', '0')
    this.leftHandle.setAttribute('y2', `${this.waveform.getHeight() + Waveform.HEADER_HEIGHT}`)
    this.leftHandle.classList = 'clip-view-handle'

    this.leftHandle.setAttribute('x1', '0')
    this.leftHandle.setAttribute('x2', '0')
    this.leftHandle.style.cursor = this.clipView.offset > 0 ? 'ew-resize' : 'e-resize'

    this.leftHandle.addEventListener('mousedown', this.leftHandleMouseDownListener)
    this.rightHandle.addEventListener('mousedown', this.rightHandleMouseDownListener)

    this.waveform.topSvgElement.appendChild(this.rightHandle)
    this.rightHandle.setAttribute('y1', '0')
    this.rightHandle.setAttribute('y2', `${this.waveform.getHeight() + Waveform.HEADER_HEIGHT}`)
    this.rightHandle.classList = 'clip-view-handle'

    this.rightHandle.style.cursor = this.clipView.length < this.clipView.clip.length ? 'ew-resize' : 'w-resize'

    this.waveform.topSvgElement.appendChild(this.svgPathElement)
    this.svgPathElement.style.strokeWidth = '1'
    this.svgPathElement.style.stroke = 'var(--waveform-stroke)'
    this.svgPathElement.style.fill = 'none'
    this.svgPathElement.style.width = '100%'
    this.svgPathElement.style.pointerEvents = 'none'
    this.svgPathElement.style.shapeRendering = 'crispEdges'

    this.waveformContextMenu = new ContextMenuController(
      `clip-view-${clipViewIndex}-contextmenu`,
      this.trackListController.pointerStateManager,
      new ContextMenuItem('Split', (_, sample) => this.splitThisClipView(sample)),
      new ContextMenuItem('Clip info...', () => {
        console.error(clipViewIndex)
      }),
      new ContextMenuItem('______', () => {}, false),
      new ContextMenuItem('Delete', () => {
        console.error(clipViewIndex)
      }),
    )
    this.headerElement.addEventListener('mousedown', (event) => {
      if (event.button == 0 && event.buttons == 1) {
        this.startClipViewMove(this, event)
      }
    })
    this.headerElement.style.cursor = 'grab'
    this.headerTitleElement.style.pointerEvents = 'none'
    this.rectElement.addEventListener('contextmenu', (event) => {
      event.preventDefault()
      this.waveformContextMenu.draw(event.clientX, event.clientY)
    })
    this.rectElement.addEventListener('mouseenter', (mouseEvent) => {
      this.trackListController.pointerStateManager.setPointedOverClipView(this)
    })
    this.rectElement.addEventListener('mouseleave', (mouseEvent) => {
      this.trackListController.pointerStateManager.removePointedOverClipView(this)
    })
  }

  async moveThisClipView(shift: number) {
    const newClipView = cloneClipViewWithNewStartPosition(this.clipView, shift)
    await this.waveform.replaceClipView(this.clipViewIndex, newClipView)
    this.waveform.draw()
  }

  private startClipViewMove(self: ClipViewController, startMouseEvent: MouseEvent) {
    this.drawWaveform(this.getSampleForXValue(-this.waveform.width), this.getSampleForXValue(2 * this.waveform.width))
    this.trackListController.pointerStateManager.startMovingClipView(this, startMouseEvent.clientX)
  }

  private async splitThisClipView(position: number) {
    this.waveform.track.split(this.clipViewIndex, position)
    this.waveform.removeClipViewController(this)
    this.waveform.draw()
    ProjectManager.saveTrack(this.waveform.track)
  }

  drawBoundingBox(startSample: number, endSample: number) {
    // for some reason this breaks down when zooming in too much, so limit to +/-10000
    const xStart = Math.max(this.getXValueForSample(this.clipView.startPosition), -10000)
    this.rectElement.x.baseVal.value = xStart
    this.headerElement.x.baseVal.value = xStart
    this.leftHandle.x1.baseVal.value = xStart
    this.leftHandle.x2.baseVal.value = xStart
    this.headerTitleElement.x.baseVal.value = xStart

    const xEnd = Math.min(this.getXValueForSample(this.clipView.getEndPosition()), 10000)
    this.rightHandle.x1.baseVal.value = xEnd
    this.rightHandle.x2.baseVal.value = xEnd

    this.rectElement.width.baseVal.value = Math.ceil(xEnd - xStart)
    this.headerElement.width.baseVal.value = Math.ceil(xEnd - xStart)
    this.headerTitleElement.width.baseVal.value = Math.ceil(xEnd - xStart)
  }

  async draw(startSample: number, endSample: number) {
    this.drawBoundingBox(startSample, endSample)
    this.drawWaveform(startSample, endSample)
  }

  async drawWaveform(startSample: number, endSample: number, fullClip = false) {
    let realStart, realEnd: number
    const clipViewStart = this.getXValueForSample(this.clipView.startPosition)
    const startSampleX = this.getXValueForSample(startSample)

    realStart = Math.max(0, startSample - this.clipView.startPosition) + this.clipView.offset
    realEnd = Math.min(endSample - this.clipView.startPosition, this.clipView.length) + this.clipView.offset

    this.pathElementTranslation = Math.max(startSampleX, clipViewStart)

    if (fullClip) {
      let extendedShift =
        clipViewStart <= 0 ? 0 : Math.min(this.clipView.startPosition - startSample, this.clipView.offset)
      extendedShift = Math.floor(extendedShift / this.samplesPerUnit) * this.samplesPerUnit
      this.pathElementTranslation -= extendedShift / this.samplesPerUnit
      realStart -= extendedShift
      realEnd = Math.min(realStart + endSample - startSample, this.clipView.clip.length)
    }

    const summary = await SummaryGenerator.summarizeClipChannel(
      this.clipView.clip,
      0,
      realStart,
      realEnd,
      this.samplesPerUnit,
    )

    this.svgPathElement.setAttribute('transform', `translate(${this.pathElementTranslation}, 0)`)

    const xAxis = Waveform.HEADER_HEIGHT + this.waveformHeight / 2

    const pathSegments = new Array(summary[0].length)
    const xIncrement = this.samplesPerUnit > 2 ? 1 : 1 / this.samplesPerUnit
    for (let i = 0; i < summary[0].length; i += 2) {
      let maximum = xAxis - (summary[0][i] * this.waveformHeight) / 2
      let minimum = xAxis - (summary[0][i + 1] * this.waveformHeight) / 2

      if (maximum - minimum < 1 && !(maximum > 0 && minimum < 0)) {
        if (maximum > 0) {
          --minimum
        } else {
          ++maximum
        }
      }
      pathSegments.push(
        `${this.samplesPerUnit > 2 ? 'L' : 'M'} ${(i / 2) * xIncrement} ${maximum} L ${(i / 2) * xIncrement} ${minimum}`,
      )
    }
    this.svgPathElement.setAttribute('d', `M 0 ${xAxis} ` + pathSegments.join(' '))
    if (this.samplesPerUnit < 2) {
      this.svgPathElement.style.strokeWidth = '2'
    } else {
      this.svgPathElement.style.strokeWidth = '1'
    }
  }

  reset() {
    this.waveform.topSvgElement.appendChild(this.rectElement)
    this.waveform.topSvgElement.appendChild(this.headerElement)
    this.waveform.topSvgElement.appendChild(this.svgPathElement)
    this.waveform.topSvgElement.appendChild(this.leftHandle)
    this.waveform.topSvgElement.appendChild(this.rightHandle)

    this.rectElement.setAttribute('transform', '')
    this.headerElement.setAttribute('transform', '')
    this.headerTitleElement.setAttribute('transform', '')
    this.svgPathElement.setAttribute('transform', '')
    this.leftHandle.setAttribute('transform', '')
    this.rightHandle.setAttribute('transform', '')

    this.draw(0, this.getSampleForXValue(this.waveform.width))
  }

  remove() {
    this.rectElement.remove()
    this.headerElement.remove()
    this.headerTitleElement.remove()
    this.svgPathElement.remove()
    this.leftHandle.remove()
    this.rightHandle.remove()
  }

  resize() {
    /*handled by parent*/
  }

  drawMoveInProgressClipView(shift: number) {
    if (Math.abs(this.rectElement.x.baseVal.value + shift) < 5) {
      shift = -this.rectElement.x.baseVal.value
    }
    this.rectElement.setAttribute('transform', `translate(${shift}, 0)`)
    this.headerElement.setAttribute('transform', `translate(${shift}, 0)`)
    this.headerTitleElement.setAttribute('transform', `translate(${shift}, 0)`)
    this.leftHandle.setAttribute('transform', `translate(${shift}, 0)`)
    this.rightHandle.setAttribute('transform', `translate(${shift}, 0)`)
    this.svgPathElement.setAttribute('transform', `translate(${this.pathElementTranslation + shift}, 0)`)
  }

  updateClipViewResize(shift: number) {
    switch (this.resizeInfo?.side) {
      case 'left':
        const maxLeftShift = this.clipView.offset / this.samplesPerUnit
        const minLeftShift = this.clipView.length / this.samplesPerUnit
        shift = Math.max(Math.min(shift, minLeftShift + 1), -maxLeftShift)
        this.leftHandle.setAttribute('transform', `translate(${shift},0)`)

        this.fullClipGrayFilter.width.baseVal.value = maxLeftShift + shift
        this.headerElement.x.baseVal.value = this.resizeInfo.oldStartX + shift
        this.headerElement.width.baseVal.value = this.resizeInfo.oldWidth - shift
        this.headerTitleElement.width.baseVal.value = this.resizeInfo.oldWidth - shift
        this.rectElement.x.baseVal.value = this.resizeInfo.oldStartX + shift
        this.rectElement.width.baseVal.value = this.resizeInfo.oldWidth - shift

        this.headerTitleElement.x.baseVal.value = this.resizeInfo.oldStartX + shift
        break
      case 'right':
        const maxRightShift =
          (this.clipView.clip.length - this.clipView.length - this.clipView.offset) / this.samplesPerUnit
        const minRightShift = -this.clipView.length / this.samplesPerUnit
        shift = Math.min(Math.max(shift, minRightShift - 1), maxRightShift)
        this.rightHandle.setAttribute('transform', `translate(${shift},0)`)

        this.fullClipGrayFilter.width.baseVal.value = maxRightShift - shift
        this.fullClipGrayFilter.x.baseVal.value = this.resizeInfo.oldStartX + this.resizeInfo.oldWidth + shift
        this.headerElement.width.baseVal.value = this.resizeInfo.oldWidth + shift
        this.headerTitleElement.width.baseVal.value = this.resizeInfo.oldWidth + shift
        this.rectElement.width.baseVal.value = this.resizeInfo.oldWidth + shift
        break
    }
  }

  async finishClipViewResize(shift: number) {
    this.rightHandle.style.opacity = '0'
    let newClipView: ClipView
    switch (this.resizeInfo!.side) {
      case 'left': {
        const maxLeftShift = this.clipView.offset / this.samplesPerUnit
        const minLeftShift = this.clipView.length / this.samplesPerUnit
        shift = Math.max(Math.min(shift, minLeftShift + 1), -maxLeftShift)
        const shiftSamples = Math.round(shift * this.samplesPerUnit)
        newClipView = new ClipView(
          this.clipView.clip,
          this.clipView.offset + shiftSamples,
          this.clipView.startPosition + shiftSamples,
          this.clipView.length - shiftSamples,
        )
        break
      }
      case 'right': {
        const maxRightShift =
          (this.clipView.clip.length - this.clipView.length - this.clipView.offset) / this.samplesPerUnit
        const minRightShift = -this.clipView.length / this.samplesPerUnit
        shift = Math.min(Math.max(shift, minRightShift - 1), maxRightShift)
        const shiftSamples = Math.round(shift * this.samplesPerUnit)
        newClipView = new ClipView(
          this.clipView.clip,
          this.clipView.offset,
          this.clipView.startPosition,
          this.clipView.length + shiftSamples,
        )
        break
      }
    }
    this.fullClipGrayFilter!.width.baseVal.value = 0
    this.resizeInfo = null
    await this.waveform.replaceClipView(this.clipViewIndex, newClipView)
  }

  private readonly leftHandleMouseDownListener = (_: MouseEvent) => {
    const clipView = this.clipView
    const maxLeftShift = this.clipView.offset / this.samplesPerUnit
    const fullClipStartX = this.getXValueForSample(this.clipView.startPosition - this.clipView.offset)
    this.resizeInfo = {
      side: 'left',
      oldStartX: this.headerElement.x.baseVal.value,
      oldWidth: this.headerElement.width.baseVal.value,
      fullClipStartX: fullClipStartX,
      fullClipEndX: fullClipStartX + this.clipView.clip.length / this.samplesPerUnit,
    }

    this.fullClipGrayFilter.x.baseVal.value = this.getXValueForSample(clipView.startPosition - clipView.offset)
    this.fullClipGrayFilter.width.baseVal.value = maxLeftShift
    this.fullClipGrayFilter.y.baseVal.value = Waveform.HEADER_HEIGHT
    this.fullClipGrayFilter.height.baseVal.value = this.waveformHeight

    this.fullClipGrayFilter.style.fill = '#00000040'
    this.fullClipGrayFilter.style.stroke = 'none'
    this.drawWaveform(this.translation * this.samplesPerUnit, this.getSampleForXValue(this.waveform.width), true)

    this.leftHandle.style.opacity = '1'
    this.trackListController.pointerStateManager.startResizingClipView(this)
  }

  private readonly rightHandleMouseDownListener = (_: MouseEvent) => {
    const clipView = this.clipView
    const maxRightShift = (clipView.clip.length - clipView.length - clipView.offset) / this.samplesPerUnit
    const filterStartX = this.getXValueForSample(clipView.getEndPosition())
    const fullClipStartX = this.getXValueForSample(this.clipView.startPosition - this.clipView.offset)
    this.resizeInfo = {
      side: 'right',
      oldStartX: this.headerElement.x.baseVal.value,
      oldWidth: this.headerElement.width.baseVal.value,
      fullClipStartX: fullClipStartX,
      fullClipEndX: fullClipStartX + this.clipView.clip.length / this.samplesPerUnit,
    }

    this.drawWaveform(this.translation * this.samplesPerUnit, this.getSampleForXValue(this.waveform.width), true)

    this.fullClipGrayFilter.x.baseVal.value = filterStartX
    this.fullClipGrayFilter.width.baseVal.value = maxRightShift
    this.fullClipGrayFilter.y.baseVal.value = Waveform.HEADER_HEIGHT
    this.fullClipGrayFilter.height.baseVal.value = this.waveformHeight
    this.fullClipGrayFilter.style.fill = '#00000040'
    this.fullClipGrayFilter.style.stroke = 'none'

    this.rightHandle.style.opacity = '1'
    this.trackListController.pointerStateManager.startResizingClipView(this)
  }
}
