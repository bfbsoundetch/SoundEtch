import { Clip } from '../../project/Clip'
import { TranscribedRange } from '../../transcription/Transcriber'
import { TrackListController } from './TrackListController'
import { TrackListItemController } from './TrackListItemController'

export class TranscriptionEditorController extends TrackListItemController {
  private readonly rectElement = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  private width: number

  constructor(
    trackListController: TrackListController,
    private readonly clip: Clip,
    private readonly topSvgElement: SVGElement,
    private readonly height: number,
    private yOffset: number,
  ) {
    super(trackListController)
    this.width = topSvgElement.clientWidth
  }

  draw() {
    const startSample = this.getSampleForXValue(0)
    const endSample = this.getSampleForXValue(this.width)
  }

  remove() {}

  resize(): void {
    this.width = this.topSvgElement.clientWidth
  }

  private findTranscriptionCoveringRange(startSample: number, endSample: number) {
    let low = 0,
      high = this.clip.transcription.length - 1
    let resultIndex = -1
    let candidate: TranscribedRange

    while (low <= high) {
      let testIndex = Math.floor((high + low) / 2)
      candidate = this.clip.transcription[testIndex]

      if (
        (candidate.endSample > startSample && candidate.endSample < endSample) ||
        (candidate.startSample > startSample && candidate.startSample < endSample)
      ) {
        resultIndex = testIndex
        break
      } else if (candidate.endSample < startSample) {
        low = testIndex + 1
      } else {
        high = testIndex - 1
      }
    }

    if (resultIndex == -1) {
      return []
    }

    let startIndex = resultIndex
    while (startIndex > 0) {
      candidate = this.clip.transcription[--startIndex]
      if (candidate!.endSample < startSample) {
        ++startIndex
        break
      }
    }

    let endIndex = resultIndex
    while (endIndex < this.clip.transcription.length - 1 && candidate!.startSample <= endSample) {
      candidate = this.clip.transcription[++endIndex]
    }

    return this.clip.transcription.slice(startIndex, endIndex)
  }
}
