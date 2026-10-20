import { AudioControl, AudioState } from '../audiocontext/AudioControl'
import { TimeUtils } from '../global/TimeUtils'
import { Clip } from '../project/Clip'
import { ProjectManager } from '../project/ProjectManager'
import type { Recorder } from '../recording/Recorder'
import { NotificationsController } from './NotificationsController'

interface AddClipWindow extends Window {
  loadRecorder(): Promise<typeof Recorder>
}

export class AddClipController {
  private readonly dialog = document.getElementById('add-clip-modal') as HTMLDialogElement
  private readonly existingClipList = document.getElementById('add-clip-existing-list') as HTMLDivElement
  private readonly clipManagerButton = document.getElementById('add-clip-open-clip-manager-button') as HTMLButtonElement
  private importingLocalFile = false

  constructor() {
    this.clipManagerButton.onclick = () => void this.openClipManager()
    this.bindFileDrop(document.getElementById('timeline-body')!)
    this.bindFileDrop(document.getElementById('welcome')!)
  }

  async importLocalFile(file: File) {
    if (this.importingLocalFile) {
      return
    }
    this.importingLocalFile = true
    try {
      // WebEntrypoint installs the shared lazy loader before constructing this controller.
      const appWindow = window as unknown as AddClipWindow
      const Recorder = await appWindow.loadRecorder()
      await Recorder.createFromFile(file)
    } finally {
      this.importingLocalFile = false
    }
  }

  private canDropFile() {
    const state = AudioControl.getState()
    return !this.importingLocalFile && (state == AudioState.STOPPED || state == AudioState.MONITORING)
  }

  private bindFileDrop(target: HTMLElement) {
    const dragOver = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) {
        return
      }
      event.preventDefault()
      const canDrop = this.canDropFile()
      event.dataTransfer.dropEffect = canDrop ? 'copy' : 'none'
      target.classList.toggle('media-file-drag-over', canDrop)
    }
    target.addEventListener('dragenter', dragOver)
    target.addEventListener('dragover', dragOver)
    target.addEventListener('dragleave', (event) => {
      if (!(event.relatedTarget instanceof Node) || !target.contains(event.relatedTarget)) {
        target.classList.remove('media-file-drag-over')
      }
    })
    target.addEventListener('drop', (event) => {
      target.classList.remove('media-file-drag-over')
      if (!event.dataTransfer?.types.includes('Files')) {
        return
      }
      event.preventDefault()
      if (!this.canDropFile()) {
        return
      }
      const files = event.dataTransfer.files
      if (files.length != 1) {
        NotificationsController.showErrorMessage('Drop one media file at a time.')
        return
      }
      // Capture the file before the drop event's data store becomes inaccessible.
      void this.importLocalFile(files[0])
    })
  }

  async refreshExistingClips() {
    const project = await ProjectManager.getActiveProject()
    const clips = project.getClips()
    this.existingClipList.replaceChildren()

    if (clips.length == 0) {
      const emptyState = document.createElement('p')
      emptyState.className = 'add-clip-existing-empty'
      emptyState.innerText = 'No clips in this project yet.'
      this.existingClipList.appendChild(emptyState)
      return
    }

    this.existingClipList.append(...clips.map((clip) => this.createExistingClipRow(clip, project.sampleRate)))
  }

  private createExistingClipRow(clip: Clip, sampleRate: number): HTMLButtonElement {
    const row = document.createElement('button')
    row.type = 'button'
    row.className = 'bordered clickable add-clip-existing-row'
    row.onclick = () => void this.insertExistingClip(clip, row)

    const nameElement = document.createElement('span')
    nameElement.className = 'add-clip-existing-name'
    nameElement.innerText = clip.name

    const metaElement = document.createElement('span')
    metaElement.className = 'add-clip-existing-meta'
    metaElement.innerText = `Length: ${TimeUtils.positionToString(clip.length, sampleRate, true)} | Created: ${this.formatDate(
      clip.dateCreated,
    )}`

    row.append(nameElement, metaElement)
    return row
  }

  private async insertExistingClip(clip: Clip, button: HTMLButtonElement) {
    button.disabled = true
    try {
      await ProjectManager.addExistingClipWithTrack(clip, AudioControl.startPosition)
      ;(window as any).trackListController?.draw?.()
      if (this.dialog.open) {
        this.dialog.close()
      }
    } catch (error) {
      NotificationsController.showError(error instanceof Error ? error : new Error(String(error)))
    } finally {
      button.disabled = false
    }
  }

  private async openClipManager() {
    if (this.dialog.open) {
      this.dialog.close()
    }
    await (window as any).clipManagerController?.open?.()
  }

  private formatDate(timestamp: number | undefined): string {
    if (!timestamp) {
      return '-'
    }
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(timestamp))
  }
}
