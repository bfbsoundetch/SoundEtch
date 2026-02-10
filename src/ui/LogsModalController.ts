import { Logger } from '../global/Logger'

export class LogsModalController {
  private readonly logsDisplay: HTMLPreElement
  private readonly logsDialog: HTMLDialogElement

  constructor() {
    this.logsDisplay = document.getElementById('logs-modal-content-text') as HTMLPreElement
    this.logsDialog = document.getElementById('logs-modal') as HTMLDialogElement

    this.logsDialog.onclick = (event) => {
      if (event.target === this.logsDialog) {
        this.logsDialog.close()
      }
    }

    const refreshButton = document.getElementById('logs-modal-refresh-button') as HTMLButtonElement
    refreshButton.onclick = () => this.refresh()

    const downloadButton = document.getElementById('logs-modal-download-button') as HTMLButtonElement
    downloadButton.onclick = () => this.download()

    const openButton = document.getElementById('open-logs-modal-button') as HTMLButtonElement
    openButton.onclick = () => {
      this.refresh()
      document.getElementById('menu-dropdown')?.hidePopover()
      this.logsDialog.showModal()
    }

    this.refresh()
  }

  refresh() {
    this.logsDisplay.textContent = Logger.getLogText() || 'No logs yet.'
  }

  download() {
    const logText = Logger.getLogText()
    const blob = new Blob([logText], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `soundetch-logs-${new Date().toISOString().replaceAll(':', '-')}.txt`
    anchor.click()
    URL.revokeObjectURL(url)
  }
}
