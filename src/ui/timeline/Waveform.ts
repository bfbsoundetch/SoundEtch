import { Track } from '../../project/Track'
import { ClipView, cloneClipViewWithNewStartPosition } from '../../project/ClipView'
import { TrackListItemController } from './TrackListItemController'
import { TrackListController } from './TrackListController'
import { ContextMenuController, ContextMenuItem } from '../../ui/ContextMenuController'
import { SummaryGenerator } from '../../project/SummaryGenerator'
import { ReplaceClipViewCommand, SetTrackClipViewsCommand, clipViewsEqual } from '../undo/UndoableActions'
import { TimelineRegionController } from './TimelineRegionController'

/** Handles displaying a track's waveform. */
export class Waveform extends TrackListItemController {
  static readonly HEADER_HEIGHT = 20
  private readonly PIXEL_RATIO = window.devicePixelRatio || 1

  topSvgElement: SVGSVGElement

  private readonly clipViewControllerMap = new Map<ClipView, ClipViewController>()
  readonly topGroupElement = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  readonly clipViewGroupElement = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  readonly aboveClipViewGroupElement = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  private readonly axesPathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  private readonly channelSeparatorPathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  private readonly color: string
  width = 0
  private height = 0

  getHeight() {
    return this.height
  }

  get fullHeight() {
    return this.height + Waveform.HEADER_HEIGHT
  }

  /**
   * @param {Track} track The track to display.
   * @param {string} div The `div` that will hold the waveform.
   */
  constructor(
    trackListController: TrackListController,
    readonly track: Track,
    readonly div: HTMLDivElement,
    readonly index: number,
  ) {
    super(trackListController)
    this.color = `var(--waveform-${index})`
    div.classList = 'waveform tracklist-item'
    div.addEventListener('dblclick', (event) => {
      trackListController.selectTrack(this)
    })
    this.topSvgElement = this.getTopSvgElement()
    this.topSvgElement.addEventListener('mouseenter', (mouseEvent) => {
      this.trackListController.pointerStateManager.setPointedOverTrack(this)
    })
    this.topSvgElement.addEventListener('mouseleave', (mouseEvent) => {
      this.trackListController.pointerStateManager.removePointedOverTrack(this)
    })

    this.topSvgElement.appendChild(this.clipViewGroupElement)
    this.topSvgElement.appendChild(this.topGroupElement)

    this.axesPathElement.style.strokeWidth = '2'
    this.axesPathElement.style.stroke = 'currentColor'
    this.axesPathElement.style.fill = 'none'
    this.topSvgElement.appendChild(this.axesPathElement)

    this.channelSeparatorPathElement.style.strokeWidth = '1'
    this.channelSeparatorPathElement.style.stroke = 'currentColor'
    this.channelSeparatorPathElement.style.fill = 'none'
    this.topSvgElement.appendChild(this.channelSeparatorPathElement)
    this.topSvgElement.appendChild(this.aboveClipViewGroupElement)
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
    this.drawAxes()
  }

  drawAudioData() {
    this.drawAudioDataForCanvasXRange(this, this.getTopSvgElement(), 0, this.width)
  }

  resize() {
    this.width = this.div.clientWidth
    this.height = Math.max(0, this.div.clientHeight - Waveform.HEADER_HEIGHT)
    this.topSvgElement.setAttribute('viewBox', `0 0 ${this.width} ${this.height + Waveform.HEADER_HEIGHT}`)
  }

  private drawAxes() {
    const channelHeight = this.height / this.track.getChannelCount()

    let axesPath = `M 1 0 L 1 ${this.height + Waveform.HEADER_HEIGHT} `
    let channelSeparatorPath = ''
    for (let channel = 0; channel < this.track.getChannelCount(); ++channel) {
      const xAxis = Waveform.HEADER_HEIGHT + channel * channelHeight + channelHeight / 2
      axesPath += `M 0 ${xAxis} L ${this.width * this.PIXEL_RATIO} ${xAxis}`

      if (channel > 0) {
        channelSeparatorPath +=
          `M 0 ${Waveform.HEADER_HEIGHT + channel * channelHeight}` +
          `L ${this.width * this.PIXEL_RATIO} ${Waveform.HEADER_HEIGHT + channel * channelHeight}`
      }
    }
    this.axesPathElement.setAttribute('d', axesPath)
    this.channelSeparatorPathElement.setAttribute('d', channelSeparatorPath)
  }

  removeClipViewController(controller: ClipViewController) {
    controller.remove()
    this.clipViewControllerMap.delete(controller.clipView)
  }

  private async drawAudioDataForCanvasXRange(
    waveform: Waveform,
    topSvgElement: SVGSVGElement,
    start: number,
    end: number,
  ) {
    for (const [clipView, clipViewController] of this.clipViewControllerMap) {
      if (!this.track.clipViews.includes(clipView)) {
        clipViewController.remove()
        this.clipViewControllerMap.delete(clipView)
      }
    }

    const startSample = waveform.getSampleForXValue(start)
    const endSample = waveform.getSampleForXValue(end)
    for (let clipViewIndex = 0; clipViewIndex < waveform.track.clipViews.length; ++clipViewIndex) {
      const currentClipView = waveform.track.clipViews[clipViewIndex]
      let clipViewController = this.clipViewControllerMap.get(currentClipView)
      if (
        currentClipView.startPosition < endSample &&
        currentClipView.startPosition + currentClipView.length > startSample
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
        } else {
          clipViewController.clipViewIndex = clipViewIndex
        }
        let startCrossFadeDuration = 0, endCrossFadeDuration = 0
        if (clipViewIndex > 0) {
          startCrossFadeDuration = Math.max(0, 
            waveform.track.clipViews[clipViewIndex - 1].getEndPosition() - currentClipView.startPosition)
        }
        if (clipViewIndex < waveform.track.clipViews.length - 1) {
          endCrossFadeDuration = Math.max(0, 
            currentClipView.getEndPosition() - waveform.track.clipViews[clipViewIndex + 1].startPosition)
        }
        clipViewController.updateCrossFades(startCrossFadeDuration, endCrossFadeDuration)
        clipViewController.draw(startSample, endSample)
      } else if (clipViewController) {
        this.removeClipViewController(clipViewController)
      }
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
    this.clipViewGroupElement.appendChild(clipViewController.rectElement)
    this.aboveClipViewGroupElement.appendChild(clipViewController.leftHandle)
    this.aboveClipViewGroupElement.appendChild(clipViewController.rightHandle)
    this.clipViewGroupElement.appendChild(clipViewController.svgPathElement)
    this.clipViewGroupElement.appendChild(clipViewController.headerElement)
    this.clipViewGroupElement.appendChild(clipViewController.headerTitleElement)
  }
}

export class ClipViewController extends TrackListItemController {

  private startCrossFadeDuration = 0
  private endCrossFadeDuration = 0

  readonly rectElement = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  readonly headerElement = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  readonly headerTitleElement = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject')
  readonly startCrossFadePathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path') as unknown as SVGPathElement
  readonly svgPathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path') as unknown as SVGPathElement
  readonly endCrossFadePathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path') as unknown as SVGPathElement
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
    public clipViewIndex: number,
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

    this.waveform.clipViewGroupElement.appendChild(this.rectElement)
    this.waveform.clipViewGroupElement.appendChild(this.headerElement)
    this.waveform.clipViewGroupElement.appendChild(this.headerTitleElement)
    this.waveform.clipViewGroupElement.appendChild(this.fullClipGrayFilter)
    this.rectElement.setAttribute('y', `${Waveform.HEADER_HEIGHT}`)
    this.rectElement.setAttribute('height', `${this.waveformHeight}`)
    this.rectElement.classList = 'waveform-rect'
    this.rectElement.style.fill = color
    this.rectElement.addEventListener('dblclick', (event) => {
      trackListController.selectClipView(clipView, this.waveform)
      event.stopPropagation()
    })

    this.rectElement.setAttribute('x', '0')

    this.headerElement.setAttribute('y', '0')
    this.headerElement.height.baseVal.value = Waveform.HEADER_HEIGHT
    this.headerElement.style.fill = 'var(--waveform-header-bg)'
    this.headerElement.style.strokeWidth = '2'
    this.headerTitleElement.y.baseVal.value = 0
    this.headerTitleElement.height.baseVal.value = Waveform.HEADER_HEIGHT
    this.headerTitleElement.style.fill = 'none'

    this.waveform.aboveClipViewGroupElement.appendChild(this.leftHandle)
    this.leftHandle.setAttribute('y1', '0')
    this.leftHandle.setAttribute('y2', `${this.waveform.getHeight() + Waveform.HEADER_HEIGHT}`)
    this.leftHandle.classList = 'clip-view-handle'

    this.leftHandle.setAttribute('x1', '0')
    this.leftHandle.setAttribute('x2', '0')
    this.leftHandle.style.cursor = this.clipView.offset > 0 ? 'ew-resize' : 'e-resize'

    this.leftHandle.addEventListener('mousedown', this.leftHandleMouseDownListener)
    this.rightHandle.addEventListener('mousedown', this.rightHandleMouseDownListener)

    this.waveform.aboveClipViewGroupElement.appendChild(this.rightHandle)
    this.rightHandle.setAttribute('y1', '0')
    this.rightHandle.setAttribute('y2', `${this.waveform.getHeight() + Waveform.HEADER_HEIGHT}`)
    this.rightHandle.classList = 'clip-view-handle'

    this.rightHandle.style.cursor = this.clipView.length < this.clipView.clip.length ? 'ew-resize' : 'w-resize'

    this.waveform.clipViewGroupElement.appendChild(this.svgPathElement)
    this.waveform.clipViewGroupElement.appendChild(this.startCrossFadePathElement)
    this.waveform.clipViewGroupElement.appendChild(this.endCrossFadePathElement)

    this.svgPathElement.classList = 'waveform-path'
    this.startCrossFadePathElement.classList = 'waveform-path'
    this.endCrossFadePathElement.classList = 'waveform-path'
    this.startCrossFadePathElement.style.opacity = '.4'
    this.endCrossFadePathElement.style.opacity = '.4'

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
    const clipViewIndex = this.waveform.track.clipViews.indexOf(this.clipView)
    if (
      clipViewsEqual(this.clipView, newClipView) ||
      !this.waveform.track.canReplaceClipView(clipViewIndex, newClipView)
    ) {
      this.reset()
      return
    }
    await this.trackListController.history.execute(
      new ReplaceClipViewCommand(this.waveform.track, this.clipView, newClipView, 'move clip view'),
    )
  }

  private startClipViewMove(self: ClipViewController, startMouseEvent: MouseEvent) {
    this.drawWaveform(this.getSampleForXValue(-this.waveform.width), this.getSampleForXValue(2 * this.waveform.width))
    this.trackListController.pointerStateManager.startMovingClipView(this, startMouseEvent.clientX)
  }

  private async splitThisClipView(position: number) {
    const clipView = this.waveform.track.clipViews[this.clipViewIndex]
    if (!clipView) {
      return
    }
    if (position <= clipView.startPosition || position >= clipView.getEndPosition()) {
      return
    }
    const firstLength = position - clipView.startPosition
    const firstNewClipView = new ClipView(clipView.clip, clipView.offset, clipView.startPosition, firstLength)
    const secondNewClipView = new ClipView(
      clipView.clip,
      clipView.offset + firstLength,
      position,
      clipView.length - firstLength,
    )
    const oldClipViews = this.waveform.track.clipViews.slice()
    const newClipViews = oldClipViews.slice()
    newClipViews.splice(this.clipViewIndex, 1, firstNewClipView, secondNewClipView)
    await this.trackListController.history.execute(
      new SetTrackClipViewsCommand(this.waveform.track, oldClipViews, newClipViews),
    )
  }

  drawBoundingBox(startSample: number, endSample: number) {
    // for some reason this breaks down when zooming in too much, so limit to +/-10000
    const xStart = Math.max(this.getXValueForSample(this.clipView.startPosition + this.startCrossFadeDuration), -10000)
    const startCrossFadeLength = this.startCrossFadeDuration / this.samplesPerUnit
    this.rectElement.x.baseVal.value = xStart
    this.headerElement.x.baseVal.value = xStart
    this.leftHandle.x1.baseVal.value = xStart - startCrossFadeLength
    this.leftHandle.x2.baseVal.value = xStart - startCrossFadeLength
    this.headerTitleElement.x.baseVal.value = xStart

    const xEnd = Math.min(this.getXValueForSample(this.clipView.getEndPosition() - this.endCrossFadeDuration), 10000)
    const endCrossFadeLength = this.endCrossFadeDuration / this.samplesPerUnit
    this.rightHandle.x1.baseVal.value = xEnd + endCrossFadeLength
    this.rightHandle.x2.baseVal.value = xEnd + endCrossFadeLength

    this.rectElement.width.baseVal.value = Math.ceil(xEnd - xStart)
    this.headerElement.width.baseVal.value = Math.ceil(xEnd - xStart)
    this.headerTitleElement.width.baseVal.value = Math.ceil(xEnd - xStart)
  }

  async draw(startSample: number, endSample: number) {
    this.drawBoundingBox(startSample, endSample)
    await this.drawWaveform(startSample, endSample)
  }

  async drawWaveform(startSample: number, endSample: number, fullClip = false) {
    let realStart, realEnd: number
    const clipViewStart = this.getXValueForSample(this.clipView.startPosition)
    const startSampleX = this.getXValueForSample(startSample)
    const crossFadeStartLastX = this.getXValueForSample(this.startCrossFadeDuration + this.clipView.startPosition)
    const crossFadeEndFirstX = this.getXValueForSample(this.clipView.getEndPosition() - this.endCrossFadeDuration)

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

    this.startCrossFadePathElement.setAttribute('transform', `translate(${this.pathElementTranslation}, 0)`)
    this.svgPathElement.setAttribute('transform', `translate(${this.pathElementTranslation}, 0)`)
    this.endCrossFadePathElement.setAttribute('transform', `translate(${this.pathElementTranslation}, 0)`)


    const summary = await SummaryGenerator.summarizeClipChannel(
      this.clipView.clip,
      realStart,
      realEnd,
      this.samplesPerUnit,
    )

    const channelCount = this.clipView.clip.getChannelCount()
    const channelHeight = this.waveformHeight / channelCount

    let fullPath = ''
    let startCrossFadePath = ''
    let endCrossFadePath = ''
    let mainPathStartX = -1
    let endCrossFadeStartX = -1
    for (let channel = 0; channel < channelCount; ++channel) {
      const xAxis = Waveform.HEADER_HEIGHT + channel * channelHeight + channelHeight / 2
      const startCrossFadeSegments = new Array()
      const endCrossFadeSegments = new Array()
      const pathSegments = new Array(summary[channel].length)
      const xIncrement = this.samplesPerUnit > 2 ? 1 : 1 / this.samplesPerUnit
      for (let i = 0; i < summary[channel].length; i += 2) {
        let maximum = xAxis - (summary[channel][i] * channelHeight) / 2
        let minimum = xAxis - (summary[channel][i + 1] * channelHeight) / 2

        if (maximum - minimum < 1 && !(maximum > 0 && minimum < 0)) {
          if (maximum > 0) {
            --minimum
          } else {
            ++maximum
          }
        }
        const position = i / 2 * xIncrement
        const pathSegment = `${this.samplesPerUnit > 2 ? 'L' : 'M'} ${position} ${maximum.toFixed(0)} L ${position} ${minimum.toFixed(0)}`
        if (position + this.pathElementTranslation < crossFadeStartLastX) {
          startCrossFadeSegments.push(pathSegment)
        } else if (position + this.pathElementTranslation > crossFadeEndFirstX) {
          if (endCrossFadeStartX == -1) {
            endCrossFadeStartX = position
          }
          endCrossFadeSegments.push(pathSegment)
        } else {
          if (mainPathStartX == -1) {
            mainPathStartX = position
          }
          pathSegments.push(pathSegment)
        }
      }
      startCrossFadePath += `M 0 ${xAxis} ` + startCrossFadeSegments.join(' ')
      fullPath += `M ${mainPathStartX} ${xAxis} ` + pathSegments.join(' ')
      endCrossFadePath += `M ${endCrossFadeStartX} ${xAxis} ` + endCrossFadeSegments.join(' ')
    }
    this.svgPathElement.setAttribute('d', fullPath)
    this.startCrossFadePathElement.setAttribute('d', startCrossFadePath)
    this.endCrossFadePathElement.setAttribute('d', endCrossFadePath)

    if (this.samplesPerUnit < 2) {
      this.startCrossFadePathElement.style.strokeWidth = '2'
      this.svgPathElement.style.strokeWidth = '2'
      this.endCrossFadePathElement.style.strokeWidth = '2'
    } else {
      this.startCrossFadePathElement.style.strokeWidth = '1'
      this.svgPathElement.style.strokeWidth = '1'
      this.endCrossFadePathElement.style.strokeWidth = '1'
    }
  }

  reset() {
    this.waveform.clipViewGroupElement.appendChild(this.rectElement)
    this.waveform.clipViewGroupElement.appendChild(this.headerElement)
    this.waveform.clipViewGroupElement.appendChild(this.headerTitleElement)
    this.waveform.clipViewGroupElement.appendChild(this.svgPathElement)
    this.waveform.clipViewGroupElement.appendChild(this.startCrossFadePathElement)
    this.waveform.clipViewGroupElement.appendChild(this.endCrossFadePathElement)
    this.waveform.aboveClipViewGroupElement.appendChild(this.leftHandle)
    this.waveform.aboveClipViewGroupElement.appendChild(this.rightHandle)

    this.rectElement.setAttribute('transform', '')
    this.headerElement.setAttribute('transform', '')
    this.headerTitleElement.setAttribute('transform', '')
    this.svgPathElement.setAttribute('transform', '')
    this.startCrossFadePathElement.setAttribute('transform', '')
    this.endCrossFadePathElement.setAttribute('transform', '')
    this.leftHandle.setAttribute('transform', '')
    this.rightHandle.setAttribute('transform', '')

    this.draw(0, this.getSampleForXValue(this.waveform.width))
  }

  remove() {
    this.rectElement.remove()
    this.headerElement.remove()
    this.headerTitleElement.remove()
    this.svgPathElement.remove()
    this.startCrossFadePathElement.remove()
    this.endCrossFadePathElement.remove()
    this.leftHandle.remove()
    this.rightHandle.remove()
    this.fullClipGrayFilter.remove()
    this.waveformContextMenu.remove()
  }

  resize() {
    /*handled by parent*/
  }

  updateCrossFades(startCrossFadeDuration: number, endCrossFadeDuration: number) {
    this.startCrossFadeDuration = startCrossFadeDuration
    this.endCrossFadeDuration = endCrossFadeDuration
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
    this.startCrossFadePathElement.setAttribute('transform', `translate(${this.pathElementTranslation + shift}, 0)`)
    this.endCrossFadePathElement.setAttribute('transform', `translate(${this.pathElementTranslation + shift}, 0)`)
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
    const clipViewIndex = this.waveform.track.clipViews.indexOf(this.clipView)
    if (
      clipViewsEqual(this.clipView, newClipView) ||
      !this.waveform.track.canReplaceClipView(clipViewIndex, newClipView)
    ) {
      this.reset()
      return
    }
    await this.trackListController.history.execute(
      new ReplaceClipViewCommand(this.waveform.track, this.clipView, newClipView, 'resize clip view'),
    )
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
