export class ProcessingModalController {
  private readonly dialog: HTMLDialogElement
  private readonly titleElement: HTMLElement
  private readonly progressBar: HTMLProgressElement
  private readonly percentElement: HTMLElement
  private readonly cancelButton: HTMLButtonElement
  private onCancel: (() => void) | null = null

  constructor() {
    this.dialog = document.getElementById('processing-modal') as HTMLDialogElement
    this.titleElement = document.getElementById('processing-modal-title') as HTMLElement
    this.progressBar = document.getElementById('processing-progress-bar') as HTMLProgressElement
    this.percentElement = document.getElementById('processing-progress-percent') as HTMLElement
    this.cancelButton = document.getElementById('processing-cancel-button') as HTMLButtonElement

    this.cancelButton.addEventListener('click', () => this.cancel())
    this.dialog.addEventListener('cancel', (event) => {
      event.preventDefault()
      this.cancel()
    })
  }

  show(title: string, onCancel: () => void) {
    this.onCancel = onCancel
    this.titleElement.textContent = title
    this.setProgress(0)
    this.dialog.showModal()
  }

  setProgress(progress: number) {
    const clamped = Math.min(1, Math.max(0, progress))
    this.progressBar.value = clamped * 100
    this.percentElement.textContent = `${Math.round(clamped * 100)}%`
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
