import { CloudBackup, type BackupStatus, type CloudBackupListing } from '../backup/CloudBackup'
import {
  CLOUD_PROVIDER_NAMES,
  getAvailableProviders,
  getSelectedProvider,
  isProviderConnected,
  setSelectedProvider,
} from '../backup/CloudProviders'
import type { CloudProviderId } from '../backup/CloudStorage'
import { connect, disconnect, prepareAuthorization, type PreparedAuthorization } from '../backup/DropboxAuthorization'
import { connectS3, disconnectS3, getS3Settings, type S3Settings } from '../backup/S3Storage'
import { ProjectManager } from '../project/ProjectManager'
import { withRecordingsStopped, withUpgradesPaused } from '../recording/UnsettledRecordings'
import { humanizeBytes } from './DiskUsage'
import { NotificationsController } from './NotificationsController'
import { editorHistory } from './undo/EditorHistory'

const PROVIDER_LABELS: Readonly<Record<CloudProviderId, string>> = {
  dropbox: 'Dropbox',
  s3: 'S3-compatible storage',
}

/**
 * Cloud backup, Dropbox in builds with its app key and S3: connecting in Settings › Cloud backup, and backing up and
 * restoring in the Import / Export dialog. One instance serves both, from whichever opens first.
 */
export class CloudBackupController {
  private static instance: CloudBackupController | null = null

  // Settings › Cloud backup
  private readonly providerRow = document.getElementById('cloud-provider-row') as HTMLElement
  private readonly providerSelect = document.getElementById('cloud-provider-select') as HTMLSelectElement
  private readonly connectionStatus = document.getElementById('cloud-connection-status') as HTMLParagraphElement
  private readonly dropboxConnectButton = document.getElementById('dropbox-connect-button') as HTMLButtonElement
  private readonly disconnectButton = document.getElementById('cloud-disconnect-button') as HTMLButtonElement
  private readonly s3Form = document.getElementById('s3-settings-form') as HTMLFormElement
  private readonly s3Fields = document.getElementById('s3-settings-fields') as HTMLElement
  private readonly s3ConnectButton = document.getElementById('s3-connect-button') as HTMLButtonElement
  private readonly setupStatus = document.getElementById('cloud-settings-status') as HTMLParagraphElement
  // Import / Export › Cloud backup
  private readonly transferDialog = document.getElementById('project-transfer-modal') as HTMLDialogElement
  private readonly backupConnectionStatus = document.getElementById(
    'cloud-backup-connection-status',
  ) as HTMLParagraphElement
  private readonly backupButton = document.getElementById('cloud-backup-button') as HTMLButtonElement
  private readonly resumeButton = document.getElementById('cloud-resume-button') as HTMLButtonElement
  private readonly cancelButton = document.getElementById('cloud-cancel-button') as HTMLButtonElement
  private readonly listButton = document.getElementById('cloud-list-button') as HTMLButtonElement
  private readonly progress = document.getElementById('cloud-backup-progress') as HTMLProgressElement
  private readonly status = document.getElementById('cloud-backup-status') as HTMLParagraphElement
  private readonly list = document.getElementById('cloud-backup-list') as HTMLUListElement

  /** The selected provider; while a backup runs or waits paused, the one it targets. */
  private provider: CloudProviderId = getAvailableProviders()[0]
  private backupStatus: BackupStatus = { kind: 'idle' }
  private connected = false
  /** The stored S3 settings, shown in the connection status. */
  private s3Settings: S3Settings | null = null
  /** The next Dropbox authorization request, ready before the click that opens it. */
  private prepared: PreparedAuthorization | null = null
  /** Stopping the recording and saving before a backup starts. */
  private startingBackup = false
  private listing = false
  private restoring = false
  private connectingS3 = false
  /** Shown in Import / Export instead of the backup status until the next status change or action. */
  private notice: string | null = null
  /** Shown in Settings › Cloud backup until the next connection action. */
  private setupNotice: string | null = null

  static start(): void {
    CloudBackupController.instance ??= new CloudBackupController()
  }

  private constructor() {
    const available = getAvailableProviders()
    this.providerSelect.replaceChildren(...available.map((provider) => new Option(PROVIDER_LABELS[provider], provider)))
    this.providerRow.hidden = available.length < 2
    document.getElementById('s3-settings-origin')!.textContent = location.origin
    this.providerSelect.onchange = () => void this.selectProvider(this.providerSelect.value as CloudProviderId)
    this.dropboxConnectButton.onclick = () => this.connectDropbox()
    this.s3Form.onsubmit = (event) => {
      event.preventDefault()
      void this.connectS3()
    }
    this.disconnectButton.onclick = () => void this.disconnect()
    this.backupButton.onclick = () => void this.backUp()
    this.resumeButton.onclick = () => void this.runAction(() => withUpgradesPaused(() => CloudBackup.resume()))
    this.cancelButton.onclick = () => void this.runAction(() => CloudBackup.cancel())
    this.listButton.onclick = () => void this.showBackups()
    window.addEventListener('beforeunload', (event) => {
      if (this.backupStatus.kind == 'uploading' || this.restoring) {
        event.preventDefault()
      }
    })
    CloudBackup.addStatusListener((status) => this.updateBackupStatus(status))
    void this.initialize()
  }

  private async initialize() {
    try {
      this.provider = (await CloudBackup.getJobProvider()) ?? (await getSelectedProvider())
      await CloudBackup.loadInterruptedJob()
      this.fillS3Form(await getS3Settings())
      await this.refreshConnection()
    } catch (error) {
      this.showError(error, 'backup')
    }
    if (getAvailableProviders().includes('dropbox')) {
      await this.prepareConnect()
    }
  }

  private async selectProvider(provider: CloudProviderId) {
    this.provider = provider
    this.notice = null
    this.setupNotice = null
    this.list.replaceChildren()
    this.list.hidden = true
    this.render()
    try {
      await setSelectedProvider(provider)
      await this.refreshConnection()
    } catch (error) {
      this.showError(error, 'setup')
    }
  }

  private async prepareConnect() {
    this.prepared = null
    this.render()
    try {
      this.prepared = await prepareAuthorization()
    } catch (error) {
      this.showError(error, 'setup')
    }
    this.render()
  }

  /** Synchronous, so the authorization tab opens within the click's user activation. */
  private connectDropbox() {
    if (!this.prepared) {
      return
    }
    const connecting = connect(this.prepared)
    this.setupNotice = 'Waiting for Dropbox authorization in the new tab…'
    void this.prepareConnect()
    connecting
      .then(() => this.afterConnecting())
      .catch((error: unknown) => {
        // A newer connection attempt replaced this one.
        if (error instanceof DOMException && error.name == 'AbortError') {
          return
        }
        this.showError(error, 'setup')
      })
  }

  private async connectS3() {
    const form = new FormData(this.s3Form)
    const field = (name: string) => String(form.get(name) ?? '')
    this.connectingS3 = true
    this.setupNotice = 'Checking the bucket…'
    this.render()
    try {
      const settings = await connectS3(
        {
          endpoint: field('endpoint'),
          region: field('region'),
          bucket: field('bucket'),
          prefix: field('prefix'),
          accessKeyId: field('accessKeyId'),
          pathStyle: form.has('pathStyle'),
        },
        field('secretAccessKey'),
      )
      this.fillS3Form(settings)
      await this.afterConnecting()
    } catch (error) {
      this.showError(error, 'setup')
    } finally {
      this.connectingS3 = false
      this.render()
    }
  }

  /** Continues a backup that paused for authorization. */
  private async afterConnecting() {
    this.notice = null
    this.setupNotice = null
    await this.refreshConnection()
    if (this.backupStatus.kind == 'paused' && this.backupStatus.reason == 'authorization') {
      await withUpgradesPaused(() => CloudBackup.resume())
    }
  }

  /** Shows `settings` in the S3 form; the secret is never shown. */
  private fillS3Form(settings: S3Settings | null) {
    const input = (name: string) => this.s3Form.elements.namedItem(name) as HTMLInputElement
    input('secretAccessKey').value = ''
    if (!settings) {
      return
    }
    input('endpoint').value = settings.endpoint
    input('region').value = settings.region
    input('bucket').value = settings.bucket
    input('prefix').value = settings.prefix
    input('accessKeyId').value = settings.accessKeyId
    input('pathStyle').checked = settings.pathStyle
  }

  private async disconnect() {
    this.setupNotice = null
    this.render()
    try {
      await (this.provider == 'dropbox' ? disconnect() : disconnectS3())
    } catch (error) {
      this.showError(error, 'setup')
    }
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
      await withRecordingsStopped(async () => {
        await ProjectManager.saveProject(project)
        await CloudBackup.start(project, this.provider)
      })
    } catch (error) {
      this.showError(error, 'backup')
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
      const listings = await CloudBackup.listBackups(this.provider)
      this.list.replaceChildren(...listings.map((listing) => this.createRow(listing)))
      if (listings.length == 0) {
        const empty = document.createElement('li')
        empty.textContent = `No backups in ${this.describeLocation()}.`
        this.list.append(empty)
      }
      this.list.hidden = false
    } catch (error) {
      this.showError(error, 'backup')
    } finally {
      this.listing = false
      this.render()
    }
  }

  private createRow(listing: CloudBackupListing): HTMLLIElement {
    const row = document.createElement('li')
    row.className = 'cloud-backup-row'
    const title = document.createElement('span')
    title.className = 'cloud-backup-row-title'
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

  private async restore(listing: CloudBackupListing) {
    const title = listing.projectTitle
    this.restoring = true
    this.notice = `Restoring “${title}”: ${humanizeBytes(0)} of ${humanizeBytes(listing.totalBytes)}`
    this.render()
    try {
      await withRecordingsStopped(async () => {
        const projectId = await CloudBackup.restore(listing, (written, total) => {
          this.notice = `Restoring “${title}”: ${humanizeBytes(written)} of ${humanizeBytes(total)}`
          this.status.textContent = this.notice
        })
        editorHistory.clear()
        await ProjectManager.openProject(projectId)
      })
      this.notice = null
      this.transferDialog.close()
      NotificationsController.showShortDurationMessage(`Restored project “${title}”.`)
    } catch (error) {
      this.showError(error, 'backup')
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
      this.showError(error, 'backup')
    }
  }

  private updateBackupStatus(status: BackupStatus) {
    const previous = this.backupStatus
    this.backupStatus = status
    if (status.kind != previous.kind) {
      this.notice = null
      if (status.kind == 'complete') {
        NotificationsController.showShortDurationMessage(
          `Backed up “${status.projectTitle}” to ${CLOUD_PROVIDER_NAMES[this.provider]}.`,
        )
      }
      // Refused credentials pause the backup and leave the provider disconnected.
      void this.refreshConnection()
    }
    this.render()
  }

  private async refreshConnection() {
    const provider = this.provider
    const connected = await isProviderConnected(provider)
    const s3Settings = provider == 's3' ? await getS3Settings() : null
    // A provider selected meanwhile refreshes itself.
    if (provider == this.provider) {
      this.connected = connected
      this.s3Settings = s3Settings
      this.render()
    }
  }

  /** Reports `error` in the notification area and next to the controls of `area`. */
  private showError(error: unknown, area: 'setup' | 'backup') {
    const reported = error instanceof Error ? error : new Error(String(error))
    if (area == 'setup') {
      this.setupNotice = reported.message
    } else {
      this.notice = reported.message
    }
    NotificationsController.showError(reported)
    void this.refreshConnection()
  }

  /** Where this provider's backups are, for messages. */
  private describeLocation(): string {
    if (this.provider == 'dropbox') {
      return 'this Dropbox App Folder'
    }
    if (!this.s3Settings) {
      return 'this bucket'
    }
    const { bucket, prefix, endpoint } = this.s3Settings
    return `${bucket}/${prefix} on ${new URL(endpoint).host}`
  }

  private render() {
    const status = this.backupStatus
    const dropbox = this.provider == 'dropbox'
    const pausedForAuthorization = status.kind == 'paused' && status.reason == 'authorization'
    const active = status.kind == 'uploading' || status.kind == 'paused'

    this.providerSelect.value = this.provider
    this.providerSelect.disabled = active || this.startingBackup || this.listing || this.restoring || this.connectingS3
    const connection = this.connected ? `Connected to ${dropbox ? 'Dropbox' : this.describeLocation()}.` : null
    this.connectionStatus.textContent = connection ?? 'Not connected.'
    this.backupConnectionStatus.textContent = connection ?? 'Not connected. Connect a service in Cloud Backup Settings.'
    this.dropboxConnectButton.textContent = pausedForAuthorization ? 'Reconnect Dropbox' : 'Connect Dropbox'
    this.dropboxConnectButton.hidden = !dropbox || (this.connected && !pausedForAuthorization)
    this.dropboxConnectButton.disabled = !this.prepared || this.restoring
    this.s3Fields.hidden = dropbox || this.connected
    this.s3ConnectButton.disabled = this.connectingS3 || this.restoring
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
    this.setupStatus.textContent = this.setupNotice ?? ''
    this.status.textContent = this.notice ?? CloudBackupController.describe(status)
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
