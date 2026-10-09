import type { Clip } from '../../project/Clip'
import type { TranscribedRange } from '../../project/Transcription'
import type { TrackListController } from './TrackListController'
import { TrackListItemController } from './TrackListItemController'

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'

export const TRANSCRIPTION_LANE_HEIGHT = 32

export interface ProjectedTranscribedRange {
  readonly text: string
  readonly startSample: number
  readonly endSample: number
  readonly speechStartSample?: number
  readonly drawStartBoundary: boolean
  readonly drawEndBoundary: boolean
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

  let low = 0
  let high = transcription.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if (transcription[middle].endSample <= visibleSourceStart) {
      low = middle + 1
    } else {
      high = middle
    }
  }

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
    })
  }
  return projected
}

interface LabelNode {
  readonly foreignObject: SVGForeignObjectElement
  readonly content: HTMLDivElement
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
  private readonly labels = new Array<LabelNode>()
  private cache: DrawCache | null = null

  constructor(
    trackListController: TrackListController,
    private readonly clip: Clip,
    parentElement: SVGGElement,
  ) {
    super(trackListController)
    this.overlayElement.classList.add('transcription-overlay')
    this.boundaryPathElement.classList.add('transcription-range-boundaries')
    this.overlayElement.appendChild(this.boundaryPathElement)
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

    const projected = projectVisibleTranscribedRanges(
      transcription,
      sourceStartSample,
      sourceEndSample,
      timelineStartSample,
      viewportStartSample,
      viewportEndSample,
    )
    let boundaryPath = ''
    let previousBoundarySample: number | null = null
    for (let index = 0; index < projected.length; ++index) {
      const range = projected[index]
      const label = this.getLabel(index)
      const rangeStartX = this.getXValueForSample(range.startSample) - overlayX
      const rangeEndX = this.getXValueForSample(range.endSample) - overlayX
      label.foreignObject.setAttribute('x', `${rangeStartX}`)
      label.foreignObject.setAttribute('y', '0')
      label.foreignObject.setAttribute('width', `${Math.max(0, rangeEndX - rangeStartX)}`)
      label.foreignObject.setAttribute('height', `${Math.max(0, laneHeight)}`)
      label.foreignObject.style.display = ''
      if (label.content.textContent !== range.text) {
        label.content.textContent = range.text
      }

      if (range.drawStartBoundary && previousBoundarySample !== range.startSample) {
        const x = rangeStartX
        boundaryPath += `M ${x} 0 V ${Math.max(0, laneHeight)} `
        previousBoundarySample = range.startSample
      }
      if (range.drawEndBoundary && previousBoundarySample !== range.endSample) {
        const x = rangeEndX
        boundaryPath += `M ${x} 0 V ${Math.max(0, laneHeight)} `
        previousBoundarySample = range.endSample
      }
    }
    this.boundaryPathElement.setAttribute('d', boundaryPath)
    for (let index = projected.length; index < this.labels.length; ++index) {
      this.labels[index].foreignObject.style.display = 'none'
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
  }

  remove(): void {
    this.overlayElement.remove()
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
