import { TimeUtils } from '../global/TimeUtils'
import { announce } from './LiveAnnouncer'

export class ProcessingModalController {
  private readonly dialog = document.getElementById('processing-modal') as HTMLDialogElement
  private readonly titleElement = document.getElementById('processing-modal-title') as HTMLElement
  private readonly progressBar = document.getElementById('processing-progress-bar') as HTMLProgressElement
  private readonly percentElement = document.getElementById('processing-progress-percent') as HTMLElement
  private readonly elapsedTimeElement = document.getElementById('processing-elapsed-time') as HTMLElement
  private readonly remainingTimeElement = document.getElementById('processing-remaining-time') as HTMLElement
  private readonly cancelButton = document.getElementById('processing-cancel-button') as HTMLButtonElement

  private onCancel: (() => void) | null = null
  private startTime = 0
  private lastAnnouncedDecile = 0

  constructor() {
    this.cancelButton.addEventListener('click', () => this.cancel())
    this.dialog.addEventListener('cancel', (event) => {
      event.preventDefault()
      this.cancel()
    })
  }

  show(title: string, onCancel: () => void) {
    this.onCancel = onCancel
    this.dialog.showModal()
    this.startTime = Date.now()
    this.setTitle(title)
    this.setProgress(0)
  }

  setTitle(title: string) {
    this.titleElement.textContent = title
    if (this.dialog.open) {
      this.startTime = Date.now()
      this.lastAnnouncedDecile = 0
      announce(title)
    }
  }

  setProgress(progress: number) {
    const clamped = Math.min(1, Math.max(0, progress))
    this.progressBar.value = clamped * 100
    this.percentElement.textContent = `${Math.round(clamped * 100)}%`
    const decile = Math.floor(clamped * 10)
    if (this.dialog.open && decile > this.lastAnnouncedDecile) {
      this.lastAnnouncedDecile = decile
      announce(`${decile * 10}% complete`)
    }

    const elapsedTime = Date.now() - this.startTime
    const totalTime = Math.round(elapsedTime / progress)
    this.elapsedTimeElement.textContent = 'Elapsed time: ' + TimeUtils.toString(elapsedTime, false, true)
    if (progress > 0.005) {
      this.remainingTimeElement.textContent =
        'Remaining time: ' + TimeUtils.toString(totalTime - elapsedTime, false, true)
    } else {
      this.remainingTimeElement.textContent = 'Remaining time: ...'
    }
  }

  hide() {
    if (this.dialog.open) {
      this.dialog.close()
    }
    this.onCancel = null
  }

  private cancel() {
    this.onCancel?.()
    this.hide()
  }
}
