import type { Clip } from '../../project/Clip'
import type { TranscribedRange, TranscriptGapKind } from '../../project/Transcription'
import { formatTranscriptGap } from '../transcript/TranscriptFormatting'
import type { TrackListController } from './TrackListController'
import { TrackListItemController } from './TrackListItemController'

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
const MIN_READABLE_WORD_FRACTION = 0.75

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
}

export class TranscriptionOverlayController extends TrackListItemController {
  private readonly overlayElement = document.createElementNS(SVG_NAMESPACE, 'svg')
  private readonly boundaryPathElement = document.createElementNS(SVG_NAMESPACE, 'path')
  private readonly placeholderPathElement = document.createElementNS(SVG_NAMESPACE, 'path')
  private readonly labels = new Array<LabelNode>()
  private cache: DrawCache | null = null
  private labelStyles: { speech: LabelStyle; gap: LabelStyle } | null = null
  private static measureContext: CanvasRenderingContext2D | null = null

  constructor(
    trackListController: TrackListController,
    private readonly clip: Clip,
    parentElement: SVGGElement,
  ) {
    super(trackListController)
    this.overlayElement.classList.add('transcription-overlay')
    this.overlayElement.setAttribute('aria-hidden', 'true')
    this.boundaryPathElement.classList.add('transcription-range-boundaries')
    this.overlayElement.appendChild(this.boundaryPathElement)
    this.placeholderPathElement.classList.add('transcription-range-placeholders')
    this.overlayElement.appendChild(this.placeholderPathElement)
    parentElement.appendChild(this.overlayElement)
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
    const transcription = this.clip.transcription
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
      this.cache.translation === this.translation
    ) {
      return
    }

    const footprintEndSample = timelineStartSample + sourceEndSample - sourceStartSample
    const overlayX = Math.max(0, this.getXValueForSample(timelineStartSample))
    const overlayEndX = Math.min(viewportWidth, this.getXValueForSample(footprintEndSample))
    const overlayWidth = Math.max(0, overlayEndX - overlayX)
    this.overlayElement.setAttribute('x', `${overlayX}`)
    this.overlayElement.setAttribute('y', `${laneTop}`)
    this.overlayElement.setAttribute('width', `${overlayWidth}`)
    this.overlayElement.setAttribute('height', `${Math.max(0, laneHeight)}`)

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
        previousBoundarySample = startSample
      }
      if (range.endSample <= visibleSourceEnd && previousBoundarySample !== endSample) {
        boundaryPath += `M ${rangeEndX} 0 V ${laneHeight} `
        previousBoundarySample = endSample
      }
    }
    flushPlaceholder()
    this.placeholderPathElement.setAttribute('d', placeholderPath)
    this.boundaryPathElement.setAttribute('d', boundaryPath)
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
    }
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
