import {
  appKey,
  connect,
  disconnect,
  isConnected,
  prepareAuthorization,
  type PreparedAuthorization,
} from '../backup/DropboxAuthorization'
import { DropboxBackup, type BackupStatus, type DropboxBackupListing } from '../backup/DropboxBackup'
import { ProjectManager } from '../project/ProjectManager'
import { Recorder } from '../recording/Recorder'
import { humanizeBytes } from './DiskUsage'
import { NotificationsController } from './NotificationsController'
import { editorHistory } from './undo/EditorHistory'

/** The Dropbox section of the Import / Export dialog; hidden unless the build has a Dropbox app key. */
export class DropboxBackupController {
  private readonly section = document.getElementById('dropbox-backup') as HTMLElement
  private readonly connectionStatus = document.getElementById('dropbox-connection-status') as HTMLParagraphElement
  private readonly connectButton = document.getElementById('dropbox-connect-button') as HTMLButtonElement
  private readonly disconnectButton = document.getElementById('dropbox-disconnect-button') as HTMLButtonElement
  private readonly backupButton = document.getElementById('dropbox-backup-button') as HTMLButtonElement
  private readonly resumeButton = document.getElementById('dropbox-resume-button') as HTMLButtonElement
  private readonly cancelButton = document.getElementById('dropbox-cancel-button') as HTMLButtonElement
  private readonly listButton = document.getElementById('dropbox-list-button') as HTMLButtonElement
  private readonly progress = document.getElementById('dropbox-backup-progress') as HTMLProgressElement
  private readonly status = document.getElementById('dropbox-backup-status') as HTMLParagraphElement
  private readonly list = document.getElementById('dropbox-backup-list') as HTMLUListElement

  private backupStatus: BackupStatus = { kind: 'idle' }
  private connected = false
  /** The next authorization request, ready before the click that opens it. */
  private prepared: PreparedAuthorization | null = null
  /** Stopping the recording and saving before a backup starts. */
  private startingBackup = false
  private listing = false
  private restoring = false
  /** Shown instead of the backup status until the next status change or action. */
  private notice: string | null = null

  constructor(private readonly dialog: HTMLDialogElement) {
    if (!appKey()) {
      return
    }
    this.section.hidden = false
    this.connectButton.onclick = () => this.connectDropbox()
    this.disconnectButton.onclick = () => void this.disconnectDropbox()
    this.backupButton.onclick = () => void this.backUp()
    this.resumeButton.onclick = () => void this.runAction(() => DropboxBackup.resume())
    this.cancelButton.onclick = () => void this.runAction(() => DropboxBackup.cancel())
    this.listButton.onclick = () => void this.showBackups()
    window.addEventListener('beforeunload', (event) => {
      if (this.backupStatus.kind == 'uploading' || this.restoring) {
        event.preventDefault()
      }
    })
    DropboxBackup.addStatusListener((status) => this.updateBackupStatus(status))
    void this.initialize()
  }

  private async initialize() {
    try {
      await DropboxBackup.loadInterruptedJob()
      await this.refreshConnection()
    } catch (error) {
      this.showError(error)
    }
    await this.prepareConnect()
  }

  private async prepareConnect() {
    this.prepared = null
    this.render()
    try {
      this.prepared = await prepareAuthorization()
    } catch (error) {
      this.showError(error)
    }
    this.render()
  }

  /** Synchronous, so the authorization tab opens within the click's user activation. */
  private connectDropbox() {
    if (!this.prepared) {
      return
    }
    const connecting = connect(this.prepared)
    this.notice = 'Waiting for Dropbox authorization in the new tab…'
    void this.prepareConnect()
    connecting
      .then(async () => {
        this.notice = null
        await this.refreshConnection()
        if (this.backupStatus.kind == 'paused' && this.backupStatus.reason == 'authorization') {
          await DropboxBackup.resume()
        }
      })
      .catch((error: unknown) => {
        // A newer connection attempt replaced this one.
        if (error instanceof DOMException && error.name == 'AbortError') {
          return
        }
        this.showError(error)
      })
  }

  private async disconnectDropbox() {
    await this.runAction(() => disconnect())
    this.list.replaceChildren()
    this.list.hidden = true
    await this.refreshConnection()
  }

  private async backUp() {
    this.notice = null
    this.startingBackup = true
    this.render()
    try {
      const project = await ProjectManager.getActiveProject()
      await Recorder.stopAndWaitForRecordings()
      await ProjectManager.saveProject(project)
      await DropboxBackup.start(project)
    } catch (error) {
      this.showError(error)
    } finally {
      this.startingBackup = false
      this.render()
    }
  }

  private async showBackups() {
    this.notice = null
    this.listing = true
    this.render()
    try {
      const listings = await DropboxBackup.listBackups()
      this.list.replaceChildren(...listings.map((listing) => this.createRow(listing)))
      if (listings.length == 0) {
        const empty = document.createElement('li')
        empty.textContent = 'No backups in this Dropbox App Folder.'
        this.list.append(empty)
      }
      this.list.hidden = false
    } catch (error) {
      this.showError(error)
    } finally {
      this.listing = false
      this.render()
    }
  }

  private createRow(listing: DropboxBackupListing): HTMLLIElement {
    const row = document.createElement('li')
    row.className = 'dropbox-backup-row'
    const title = document.createElement('span')
    title.className = 'dropbox-backup-row-title'
    title.textContent = listing.projectTitle
    const date = document.createElement('span')
    date.textContent = new Date(listing.createdAt).toLocaleString()
    const size = document.createElement('span')
    size.textContent = humanizeBytes(listing.totalBytes)
    const restoreButton = document.createElement('button')
    restoreButton.className = 'bordered clickable'
    restoreButton.type = 'button'
    restoreButton.textContent = 'Restore'
    restoreButton.disabled = this.restoring || !this.connected
    restoreButton.onclick = () => void this.restore(listing)
    row.append(title, date, size, restoreButton)
    return row
  }

  private async restore(listing: DropboxBackupListing) {
    const title = listing.projectTitle
    this.restoring = true
    this.notice = `Restoring “${title}”: ${humanizeBytes(0)} of ${humanizeBytes(listing.totalBytes)}`
    this.render()
    try {
      await Recorder.stopAndWaitForRecordings()
      const projectId = await DropboxBackup.restore(listing, (written, total) => {
        this.notice = `Restoring “${title}”: ${humanizeBytes(written)} of ${humanizeBytes(total)}`
        this.status.textContent = this.notice
      })
      editorHistory.clear()
      await ProjectManager.openProject(projectId)
      this.notice = null
      this.dialog.close()
      NotificationsController.showShortDurationMessage(`Restored project “${title}”.`)
    } catch (error) {
      this.showError(error)
    } finally {
      this.restoring = false
      this.render()
    }
  }

  /** Runs a backup action whose result the status listener renders; reports its rejection. */
  private async runAction(action: () => Promise<unknown>) {
    this.notice = null
    this.render()
    try {
      await action()
    } catch (error) {
      this.showError(error)
    }
  }

  private updateBackupStatus(status: BackupStatus) {
    const previous = this.backupStatus
    this.backupStatus = status
    if (status.kind != previous.kind) {
      this.notice = null
      if (status.kind == 'complete') {
        NotificationsController.showShortDurationMessage(`Backed up “${status.projectTitle}” to Dropbox.`)
      }
      // An expired or rejected token pauses the backup and leaves Dropbox disconnected.
      void this.refreshConnection()
    }
    this.render()
  }

  private async refreshConnection() {
    this.connected = await isConnected()
    this.render()
  }

  private showError(error: unknown) {
    const reported = error instanceof Error ? error : new Error(String(error))
    this.notice = reported.message
    NotificationsController.showError(reported)
    void this.refreshConnection()
  }

  private render() {
    const status = this.backupStatus
    const pausedForAuthorization = status.kind == 'paused' && status.reason == 'authorization'
    const active = status.kind == 'uploading' || status.kind == 'paused'

    this.connectionStatus.textContent = this.connected ? 'Connected to Dropbox.' : 'Not connected.'
    this.connectButton.textContent = pausedForAuthorization ? 'Reconnect Dropbox' : 'Connect Dropbox'
    this.connectButton.hidden = this.connected && !pausedForAuthorization
    this.connectButton.disabled = !this.prepared || this.restoring
    this.disconnectButton.hidden = !this.connected
    this.disconnectButton.disabled = this.restoring
    this.backupButton.disabled =
      !this.connected ||
      !(status.kind == 'idle' || status.kind == 'complete' || status.kind == 'failed') ||
      this.startingBackup ||
      this.restoring
    this.resumeButton.hidden = status.kind != 'paused'
    this.resumeButton.disabled = (pausedForAuthorization && !this.connected) || this.restoring
    this.cancelButton.hidden = !active
    this.cancelButton.disabled = this.restoring
    this.listButton.disabled = !this.connected || this.listing || this.restoring
    this.list.querySelectorAll('button').forEach((button) => {
      button.disabled = this.restoring || !this.connected
    })

    this.progress.hidden = !active
    if (active) {
      this.progress.value = status.totalBytes > 0 ? status.uploadedBytes / status.totalBytes : 0
    }
    this.status.textContent = this.notice ?? DropboxBackupController.describe(status)
  }

  private static describe(status: BackupStatus): string {
    switch (status.kind) {
      case 'idle':
        return ''
      case 'uploading':
        return `Backing up “${status.projectTitle}”: ${humanizeBytes(status.uploadedBytes)} of ${humanizeBytes(status.totalBytes)}`
      case 'paused':
      case 'failed':
        return status.message
      case 'complete':
        return `Backed up “${status.projectTitle}”.`
    }
  }
}
