import { TrackListController } from './TrackListController'

export abstract class TrackListItemController {
  constructor(protected readonly trackListController: TrackListController) {}

  abstract resize(): void

  get translation() {
    return this.trackListController.translation
  }

  get msPerUnit() {
    return this.trackListController.msScale
  }

  get samplesPerUnit() {
    return this.trackListController.sampleScale
  }

  get sampleRate() {
    return this.trackListController.sampleRate
  }

  getSampleForXValue(x: number) {
    return Math.round((x + this.translation) * this.samplesPerUnit)
  }

  getXValueForSample(sample: number) {
    return sample / this.samplesPerUnit - this.translation
  }

  mouseEventToSvgCoord(event: MouseEvent): DOMPoint {
    return this.trackListController.mouseEventToSvgCoord(event)
  }

  mouseXToSvgCoord(x: number): number {
    return this.trackListController.mouseXToSvgCoord(x)
  }
}
