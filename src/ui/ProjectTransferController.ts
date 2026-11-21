import { withRecordingsStopped } from '../recording/UnsettledRecordings'
import { CloudBackupController } from './CloudBackupController'
import { ProjectArchive } from '../project/ProjectArchive'
import { ProjectManager } from '../project/ProjectManager'
import { NotificationsController } from './NotificationsController'
import { editorHistory } from './undo/EditorHistory'

export class ProjectTransferController {
  private readonly dialog = document.getElementById('project-transfer-modal') as HTMLDialogElement
  private readonly exportButton = document.getElementById('project-transfer-export-button') as HTMLButtonElement
  private readonly importButton = document.getElementById('project-transfer-import-button') as HTMLButtonElement
  private readonly importInput = document.getElementById('project-transfer-import-input') as HTMLInputElement
  private readonly status = document.getElementById('project-transfer-status') as HTMLParagraphElement

  constructor() {
    this.exportButton.onclick = () => void this.exportProject()
    this.importButton.onclick = () => this.importInput.click()
    this.importInput.onchange = () => void this.importProject()
    new CloudBackupController(this.dialog)
  }

  private async exportProject() {
    try {
      const project = await ProjectManager.getActiveProject()
      const fileHandle = await window.showSaveFilePicker({
        suggestedName: ProjectArchive.getSuggestedFileName(project.title),
        types: [
          {
            description: 'SoundEtch project archive',
            accept: { 'application/x-tar': ['.tar'] },
          },
        ],
      })

      this.setBusy(true)
      await withRecordingsStopped(async () => {
        this.status.innerText = `Exporting “${project.title}”…`
        await ProjectManager.saveProject(project)
        const writable = await fileHandle.createWritable()
        try {
          await ProjectArchive.exportProject(project, {
            async write(data) {
              await writable.write(data)
            },
          })
          await writable.close()
        } catch (error) {
          try {
            await writable.abort()
          } catch (abortError) {
            throw new AggregateError([error, abortError], 'Project export failed and the output could not be discarded')
          }
          throw error
        }
      })
      this.status.innerText = `Exported “${project.title}”.`
      NotificationsController.showShortDurationMessage(`Exported project “${project.title}”.`)
    } catch (error) {
      if (!(error instanceof DOMException) || error.name != 'AbortError') {
        this.showError(error)
      }
    } finally {
      this.setBusy(false)
      if (this.dialog.open) this.exportButton.focus()
    }
  }

  private async importProject() {
    const archive = this.importInput.files?.item(0)
    this.importInput.value = ''
    if (!archive) {
      return
    }

    this.setBusy(true)
    try {
      const project = await withRecordingsStopped(async () => {
        this.status.innerText = `Importing “${archive.name}”…`
        const projectId = await ProjectArchive.importProject(archive)
        editorHistory.clear()
        return ProjectManager.openProject(projectId)
      })
      this.dialog.close()
      NotificationsController.showShortDurationMessage(`Imported project “${project.title}”.`)
    } catch (error) {
      this.showError(error)
    } finally {
      this.setBusy(false)
      if (this.dialog.open) this.importButton.focus()
    }
  }

  private setBusy(busy: boolean) {
    this.exportButton.disabled = busy
    this.importButton.disabled = busy
    this.importInput.disabled = busy
  }

  private showError(error: unknown) {
    const projectError = error instanceof Error ? error : new Error(String(error))
    this.status.innerText = projectError.message
    NotificationsController.showError(projectError)
  }
}
