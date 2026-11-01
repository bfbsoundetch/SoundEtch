import { TimeUtils } from '../../global/TimeUtils'
import type { Clip } from '../../project/Clip'
import {
  findTranscriptBoundary,
  type TranscribedRange,
  type TranscriptBoundary,
  type TranscriptGapKind,
} from '../../project/Transcription'
import { formatTranscriptGap } from '../transcript/TranscriptFormatting'
import type { TrackListController } from './TrackListController'
import { TrackListItemController } from './TrackListItemController'
import type { TranscriptBoundaryGrab } from './TranscriptBoundaryController'

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
const MIN_READABLE_WORD_FRACTION = 0.75
const BOUNDARY_KEYBOARD_HELP =
  'Drag or use the arrow keys to move this boundary by a ruler tick; Page Up and Page Down move further, and Home and End to its limits. Plus and minus zoom; Escape cancels a drag.'

export const TRANSCRIPTION_LANE_HEIGHT = 32

export interface ProjectedTranscribedRange {
  readonly text: string
  readonly startSample: number
  readonly endSample: number
  readonly speechStartSample?: number
  readonly kind?: TranscriptGapKind
  readonly drawStartBoundary: boolean
  readonly drawEndBoundary: boolean
}

function firstIntersectingRange(transcription: readonly TranscribedRange[], startSample: number): number {
  let low = 0
  let high = transcription.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if (transcription[middle].endSample <= startSample) {
      low = middle + 1
    } else {
      high = middle
    }
  }
  return low
}

export function projectVisibleTranscribedRanges(
  transcription: readonly TranscribedRange[],
  sourceStartSample: number,
  sourceEndSample: number,
  timelineStartSample: number,
  viewportStartSample: number,
  viewportEndSample: number,
): ProjectedTranscribedRange[] {
  const visibleSourceStart = Math.max(sourceStartSample, sourceStartSample + viewportStartSample - timelineStartSample)
  const visibleSourceEnd = Math.min(sourceEndSample, sourceStartSample + viewportEndSample - timelineStartSample)
  if (visibleSourceStart >= visibleSourceEnd || transcription.length === 0) {
    return []
  }

  const low = firstIntersectingRange(transcription, visibleSourceStart)

  const projected = new Array<ProjectedTranscribedRange>()
  for (let index = low; index < transcription.length; ++index) {
    const range = transcription[index]
    if (range.startSample >= visibleSourceEnd) {
      break
    }
    projected.push({
      text: range.text,
      startSample: timelineStartSample + range.startSample - sourceStartSample,
      endSample: timelineStartSample + range.endSample - sourceStartSample,
      speechStartSample:
        range.speechStartSample === undefined
          ? undefined
          : timelineStartSample + range.speechStartSample - sourceStartSample,
      drawStartBoundary: range.startSample >= visibleSourceStart,
      drawEndBoundary: range.endSample <= visibleSourceEnd,
      kind: range.kind,
    })
  }
  return projected
}

interface LabelNode {
  readonly foreignObject: SVGForeignObjectElement
  readonly content: HTMLDivElement
}

interface LabelStyle {
  readonly font: string
  readonly padding: number
  readonly wordWidths: Map<string, number>
}

interface DrawCache {
  readonly transcription: readonly TranscribedRange[]
  readonly transcriptionLength: number
  readonly sourceStartSample: number
  readonly sourceEndSample: number
  readonly timelineStartSample: number
  readonly viewportStartSample: number
  readonly viewportEndSample: number
  readonly viewportWidth: number
  readonly laneTop: number
  readonly laneHeight: number
  readonly samplesPerUnit: number
  readonly translation: number
  readonly activeSample: number | null
  readonly editable: boolean
}

function describeRange(range: TranscribedRange): string {
  if (range.kind === 'silence') return 'silence'
  if (range.kind === 'untranscribed') return 'untranscribed audio'
  const text = range.text.trim()
  return text ? `“${text}”` : 'a word'
}

/** Names the ranges a boundary separates, for assistive technology. */
function describeBoundary(ranges: readonly TranscribedRange[], boundary: TranscriptBoundary | null): string {
  const ending = boundary && boundary.ending >= 0 ? describeRange(ranges[boundary.ending]) : null
  const starting = boundary && boundary.starting >= 0 ? describeRange(ranges[boundary.starting]) : null
  if (ending && starting) return `Boundary between ${ending} and ${starting}`
  if (ending) return `End of ${ending}`
  if (starting) return `Start of ${starting}`
  return 'Transcript boundary'
}

export class TranscriptionOverlayController extends TrackListItemController {
  private readonly overlayElement = document.createElementNS(SVG_NAMESPACE, 'svg')
  private readonly boundaryPathElement = document.createElementNS(SVG_NAMESPACE, 'path')
  private readonly activeBoundaryPathElement = document.createElementNS(SVG_NAMESPACE, 'path')
  private readonly placeholderPathElement = document.createElementNS(SVG_NAMESPACE, 'path')
  /** Focusable sliders over the drawn boundaries, above the timeline selection, that start drags. */
  private readonly handlesElement = document.createElementNS(SVG_NAMESPACE, 'g')
  private readonly handles = new Array<SVGLineElement>()
  /** The drawn boundaries in clip source samples, in timeline order, one per handle. */
  private boundarySamples: number[] = []
  /** The boundary keyboard focus stays on while it is drawn, in clip source samples. */
  private focusSample: number | null = null
  private restoringFocus = false
  private readonly labels = new Array<LabelNode>()
  private cache: DrawCache | null = null
  private labelStyles: { speech: LabelStyle; gap: LabelStyle } | null = null
  private static measureContext: CanvasRenderingContext2D | null = null

  constructor(
    trackListController: TrackListController,
    private readonly clip: Clip,
    parentElement: SVGGElement,
    handleParentElement: SVGGElement,
  ) {
    super(trackListController)
    this.overlayElement.classList.add('transcription-overlay')
    this.overlayElement.setAttribute('aria-hidden', 'true')
    this.boundaryPathElement.classList.add('transcription-range-boundaries')
    this.overlayElement.appendChild(this.boundaryPathElement)
    this.activeBoundaryPathElement.classList.add('transcription-range-boundary-active')
    this.overlayElement.appendChild(this.activeBoundaryPathElement)
    this.placeholderPathElement.classList.add('transcription-range-placeholders')
    this.overlayElement.appendChild(this.placeholderPathElement)
    parentElement.appendChild(this.overlayElement)
    this.handlesElement.classList.add('transcription-boundary-handles')
    this.handlesElement.addEventListener('pointerdown', (event) => this.grabBoundary(event))
    this.handlesElement.addEventListener('keydown', (event) => {
      const grab = this.grabAt(this.handleSample(event.target))
      if (grab) this.trackListController.transcriptBoundaries.handleKey(event, grab)
    })
    handleParentElement.appendChild(this.handlesElement)
  }

  draw(
    sourceStartSample: number,
    sourceEndSample: number,
    timelineStartSample: number,
    viewportStartSample: number,
    viewportEndSample: number,
    viewportWidth: number,
    laneTop: number,
    laneHeight: number,
  ): void {
    const boundaries = this.trackListController.transcriptBoundaries
    const transcription = boundaries.transcription(this.clip)
    const activeSample = boundaries.activeSample(this.clip)
    const editable = this.trackListController.canEdit()
    if (
      this.cache?.transcription === transcription &&
      this.cache.transcriptionLength === transcription.length &&
      this.cache.sourceStartSample === sourceStartSample &&
      this.cache.sourceEndSample === sourceEndSample &&
      this.cache.timelineStartSample === timelineStartSample &&
      this.cache.viewportStartSample === viewportStartSample &&
      this.cache.viewportEndSample === viewportEndSample &&
      this.cache.viewportWidth === viewportWidth &&
      this.cache.laneTop === laneTop &&
      this.cache.laneHeight === laneHeight &&
      this.cache.samplesPerUnit === this.samplesPerUnit &&
      this.cache.translation === this.translation &&
      this.cache.activeSample === activeSample &&
      this.cache.editable === editable
    ) {
      return
    }
    // Handles are reassigned below, so focus is put back on its boundary afterwards.
    const hadFocus = this.handlesElement.contains(document.activeElement)
    if (hadFocus && activeSample !== null) this.focusSample = activeSample

    const footprintEndSample = timelineStartSample + sourceEndSample - sourceStartSample
    const overlayX = Math.max(0, this.getXValueForSample(timelineStartSample))
    const overlayEndX = Math.min(viewportWidth, this.getXValueForSample(footprintEndSample))
    const overlayWidth = Math.max(0, overlayEndX - overlayX)
    this.overlayElement.setAttribute('x', `${overlayX}`)
    this.overlayElement.setAttribute('y', `${laneTop}`)
    this.overlayElement.setAttribute('width', `${overlayWidth}`)
    this.overlayElement.setAttribute('height', `${Math.max(0, laneHeight)}`)
    this.handlesElement.setAttribute('transform', `translate(${overlayX} ${laneTop})`)

    const visibleSourceStart = Math.max(sourceStartSample, sourceStartSample + viewportStartSample - timelineStartSample)
    const visibleSourceEnd = Math.min(sourceEndSample, sourceStartSample + viewportEndSample - timelineStartSample)
    let labelCount = 0
    let placeholderPath = ''
    let placeholderStart = 0
    let placeholderEnd = -1
    const flushPlaceholder = () => {
      if (placeholderEnd >= 0) {
        placeholderPath += `M ${placeholderStart} ${laneHeight / 2} H ${placeholderEnd} `
        placeholderEnd = -1
      }
    }
    let boundaryPath = ''
    const boundarySamples = new Array<number>()
    const boundaryXs = new Array<number>()
    let previousBoundarySample: number | null = null
    for (
      let index = firstIntersectingRange(transcription, visibleSourceStart);
      overlayWidth > 0 && laneHeight > 0 && visibleSourceStart < visibleSourceEnd && index < transcription.length;
      ++index
    ) {
      const range = transcription[index]
      if (range.startSample >= visibleSourceEnd) break
      const startSample = timelineStartSample + range.startSample - sourceStartSample
      const endSample = timelineStartSample + range.endSample - sourceStartSample
      const rangeStartX = this.getXValueForSample(startSample) - overlayX
      const rangeEndX = this.getXValueForSample(endSample) - overlayX
      const visibleStartX = Math.max(0, rangeStartX)
      const visibleEndX = Math.min(overlayWidth, rangeEndX)
      const rangeWidth = rangeEndX - rangeStartX
      const styles = this.getLabelStyles()
      const style = range.kind === undefined ? styles.speech : styles.gap
      // Subpixel intervals need neither text formatting nor font measurement.
      const text =
        rangeWidth <= style.padding
          ? ''
          : range.kind === undefined
            ? range.text
            : formatTranscriptGap(
                range.kind,
                Math.min(endSample, footprintEndSample) - Math.max(startSample, timelineStartSample),
                this.sampleRate,
              )
      if (!this.canReadWord(text, rangeWidth, style)) {
        if (placeholderEnd < 0 || visibleStartX > placeholderEnd + 1) {
          flushPlaceholder()
          placeholderStart = visibleStartX
        }
        placeholderEnd = Math.max(placeholderEnd, visibleEndX)
        continue
      }
      flushPlaceholder()
      const label = this.getLabel(labelCount++)
      label.foreignObject.setAttribute('x', `${rangeStartX}`)
      label.foreignObject.setAttribute('y', '0')
      label.foreignObject.setAttribute('width', `${rangeWidth}`)
      label.foreignObject.setAttribute('height', `${laneHeight}`)
      label.foreignObject.classList.toggle('transcription-gap-label', range.kind !== undefined)
      if (label.content.textContent !== text) {
        label.content.textContent = text
      }
      if (range.startSample >= visibleSourceStart && previousBoundarySample !== startSample) {
        boundaryPath += `M ${rangeStartX} 0 V ${laneHeight} `
        boundarySamples.push(range.startSample)
        boundaryXs.push(rangeStartX)
        previousBoundarySample = startSample
      }
      if (range.endSample <= visibleSourceEnd && previousBoundarySample !== endSample) {
        boundaryPath += `M ${rangeEndX} 0 V ${laneHeight} `
        boundarySamples.push(range.endSample)
        boundaryXs.push(rangeEndX)
        previousBoundarySample = endSample
      }
    }
    flushPlaceholder()
    this.placeholderPathElement.setAttribute('d', placeholderPath)
    this.boundaryPathElement.setAttribute('d', boundaryPath)
    const timelineShift = timelineStartSample - sourceStartSample
    const limits = {
      minimumSample: sourceStartSample,
      maximumSample: sourceEndSample,
      tolerance: boundaries.tolerance(),
    }
    const seconds = (sample: number) => ((sample + timelineShift) / this.sampleRate).toFixed(3)
    boundarySamples.forEach((sample, index) => {
      const handle = this.getHandle(index)
      handle.setAttribute('x1', `${boundaryXs[index]}`)
      handle.setAttribute('x2', `${boundaryXs[index]}`)
      handle.setAttribute('y2', `${laneHeight}`)
      handle.tabIndex = editable ? 0 : -1
      handle.setAttribute('aria-disabled', String(!editable))
      const boundary = findTranscriptBoundary(transcription, sample, limits)
      handle.setAttribute('aria-label', describeBoundary(transcription, boundary))
      handle.setAttribute('aria-valuemin', seconds(boundary?.lowestSample ?? sample))
      handle.setAttribute('aria-valuemax', seconds(boundary?.highestSample ?? sample))
      handle.setAttribute('aria-valuenow', seconds(sample))
      handle.setAttribute(
        'aria-valuetext',
        TimeUtils.toSpokenString(((sample + timelineShift) * 1000) / this.sampleRate),
      )
    })
    while (this.handles.length > boundarySamples.length) {
      this.handles.pop()!.remove()
    }
    this.boundarySamples = boundarySamples
    this.activeBoundaryPathElement.setAttribute(
      'd',
      activeSample !== null &&
        overlayWidth > 0 &&
        laneHeight > 0 &&
        activeSample >= visibleSourceStart &&
        activeSample <= visibleSourceEnd
        ? `M ${this.getXValueForSample(timelineStartSample + activeSample - sourceStartSample) - overlayX} 0 V ${laneHeight}`
        : '',
    )
    while (this.labels.length > labelCount) {
      this.labels.pop()!.foreignObject.remove()
    }

    this.cache = {
      transcription,
      transcriptionLength: transcription.length,
      sourceStartSample,
      sourceEndSample,
      timelineStartSample,
      viewportStartSample,
      viewportEndSample,
      viewportWidth,
      laneTop,
      laneHeight,
      samplesPerUnit: this.samplesPerUnit,
      translation: this.translation,
      activeSample,
      editable,
    }
    if (hadFocus) this.restoreFocus()
  }

  invalidate(): void {
    this.cache = null
  }

  resize(): void {
    this.invalidate()
    this.labelStyles = null
  }

  remove(): void {
    this.overlayElement.remove()
    if (this.handlesElement.contains(document.activeElement)) this.focusTrack()
    this.handlesElement.remove()
  }

  /** Hands the drawn boundary nearest the pointer to the drag controller, and focuses it. */
  private grabBoundary(event: PointerEvent): void {
    const cache = this.cache
    if (!cache || this.boundarySamples.length === 0) return
    const timelineShift = cache.timelineStartSample - cache.sourceStartSample
    const x = this.mouseXToSvgCoord(event.clientX)
    let sample = this.boundarySamples[0]
    let distance = Infinity
    for (const candidate of this.boundarySamples) {
      const candidateDistance = Math.abs(this.getXValueForSample(candidate + timelineShift) - x)
      if (candidateDistance < distance) {
        sample = candidate
        distance = candidateDistance
      }
    }
    this.trackListController.transcriptBoundaries.start(event, this.handlesElement, this.grabAt(sample)!)
    if (event.defaultPrevented) this.focusBoundary(sample, true)
  }

  private grabAt(sample: number | null): TranscriptBoundaryGrab | null {
    const cache = this.cache
    if (!cache || sample === null) return null
    return {
      clip: this.clip,
      sample,
      minimumSample: cache.sourceStartSample,
      maximumSample: cache.sourceEndSample,
      timelineShift: cache.timelineStartSample - cache.sourceStartSample,
      focus: (boundary) => this.focusBoundary(boundary),
    }
  }

  /** The boundary a handle stands for, in clip source samples. */
  private handleSample(target: EventTarget | null): number | null {
    const index = this.handles.findIndex((handle) => handle === target)
    return index < 0 ? null : this.boundarySamples[index]
  }

  private getHandle(index: number): SVGLineElement {
    const existing = this.handles[index]
    if (existing) {
      return existing
    }
    const handle = document.createElementNS(SVG_NAMESPACE, 'line')
    handle.classList.add('transcription-boundary-handle')
    handle.setAttribute('role', 'slider')
    handle.setAttribute('aria-orientation', 'horizontal')
    handle.setAttribute('aria-description', BOUNDARY_KEYBOARD_HELP)
    handle.setAttribute('y1', '0')
    // On the handle itself: a focus listener on the group would make Chromium focus the group.
    handle.addEventListener('focus', () => {
      if (!this.restoringFocus) this.focusSample = this.handleSample(handle)
    })
    this.handlesElement.appendChild(handle)
    this.handles.push(handle)
    return handle
  }

  /** Keeps keyboard focus on the boundary now at `sample`; `take` also brings focus here from elsewhere. */
  private focusBoundary(sample: number, take = false): void {
    this.focusSample = sample
    if (take || this.handlesElement.contains(document.activeElement)) this.restoreFocus()
  }

  /** Focuses the focused boundary's handle, the nearest handle once it is gone, or else the track. */
  private restoreFocus(): void {
    const target = this.cache?.activeSample ?? this.focusSample
    if (target === null) return
    let index = this.boundarySamples.indexOf(target)
    if (index < 0) {
      // A committing move draws its boundary shortly; keep focus until then.
      if (
        this.trackListController.transcriptBoundaries.isEditing &&
        this.handlesElement.contains(document.activeElement)
      ) {
        return
      }
      let distance = Infinity
      this.boundarySamples.forEach((sample, candidate) => {
        if (Math.abs(sample - target) < distance) {
          distance = Math.abs(sample - target)
          index = candidate
        }
      })
    }
    if (index < 0) {
      this.focusTrack()
      return
    }
    const handle = this.handles[index]
    if (handle === document.activeElement) return
    this.restoringFocus = true
    try {
      handle.focus({ preventScroll: true })
    } finally {
      this.restoringFocus = false
    }
  }

  /** Hands keyboard focus to the track's timeline control when no boundary can keep it. */
  private focusTrack(): void {
    const waveform = this.trackListController.waveforms.find((candidate) => candidate.div.contains(this.handlesElement))
    if (waveform) this.trackListController.timelineKeyboard.focus(waveform)
  }

  private getLabelStyles(): { speech: LabelStyle; gap: LabelStyle } {
    if (this.labelStyles) return this.labelStyles
    const label = this.getLabel(0)
    const readStyle = (): LabelStyle => {
      const style = getComputedStyle(label.content)
      return {
        font: style.font,
        padding: parseFloat(style.paddingLeft) + parseFloat(style.paddingRight),
        wordWidths: new Map(),
      }
    }
    label.foreignObject.classList.remove('transcription-gap-label')
    const speech = readStyle()
    label.foreignObject.classList.add('transcription-gap-label')
    const gap = readStyle()
    label.foreignObject.classList.remove('transcription-gap-label')
    return (this.labelStyles = { speech, gap })
  }

  private canReadWord(text: string, width: number, style: LabelStyle): boolean {
    if (!text || width <= style.padding) return false
    let wordWidth = style.wordWidths.get(text)
    if (wordWidth === undefined) {
      const context = (TranscriptionOverlayController.measureContext ??= document.createElement('canvas').getContext('2d')!)
      context.font = style.font
      const words = text.trim().replace(/\s+/g, ' ')
      const textWidth = context.measureText(words).width
      wordWidth = words ? MIN_READABLE_WORD_FRACTION * textWidth : Infinity
      if (words.includes(' ')) {
        const center = textWidth / 2
        const spaceWidth = context.measureText(' ').width
        let start = 0
        wordWidth = Infinity
        // At this zoom, the centered label must expose at least 75% of one word.
        for (const word of words.matchAll(/\S+/g)) {
          const width = context.measureText(word[0]).width
          const distance = Math.abs(start + width / 2 - center)
          wordWidth = Math.min(
            wordWidth,
            Math.max(MIN_READABLE_WORD_FRACTION * width, 2 * distance + (2 * MIN_READABLE_WORD_FRACTION - 1) * width),
          )
          if (start >= center) break
          start += width + spaceWidth
        }
      }
      style.wordWidths.set(text, wordWidth)
    }
    return width >= wordWidth + style.padding
  }

  private getLabel(index: number): LabelNode {
    const existing = this.labels[index]
    if (existing) {
      return existing
    }

    const foreignObject = document.createElementNS(SVG_NAMESPACE, 'foreignObject')
    const content = document.createElement('div')
    foreignObject.classList.add('transcription-range-label')
    foreignObject.appendChild(content)
    this.overlayElement.appendChild(foreignObject)
    const label = { foreignObject, content }
    this.labels.push(label)
    return label
  }
}
