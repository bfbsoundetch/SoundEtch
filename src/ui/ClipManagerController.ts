import { Clip } from '../project/Clip'
import { Project } from '../project/Project'
import { ProjectManager } from '../project/ProjectManager'
import { getClipDiskUsage, humanizeBytes } from './DiskUsage'
import { editorHistory } from './undo/EditorHistory'
import { NotificationsController } from './NotificationsController'
import { announce } from './LiveAnnouncer'

export class ClipManagerController {
  private readonly dialog = document.getElementById('clip-manager-modal') as HTMLDialogElement
  private readonly openButton = document.getElementById('open-clip-manager-modal-button') as HTMLButtonElement
  private readonly listContainer = document.getElementById('clip-manager-list') as HTMLDivElement
  private readonly deleteUnusedButton = document.getElementById(
    'clip-manager-delete-unused-button',
  ) as HTMLButtonElement
  private readonly metadataDialog = document.getElementById('clip-metadata-modal') as HTMLDialogElement
  private readonly metadataTitle = document.getElementById('clip-metadata-title') as HTMLHeadingElement
  private readonly metadataList = document.getElementById('clip-metadata-list') as HTMLDListElement
  private readonly metadataBackButton = document.getElementById('clip-metadata-back-button') as HTMLButtonElement
  private readonly metadataRenameButton = document.getElementById('clip-metadata-rename-button') as HTMLButtonElement
  private readonly titleElement = document.getElementById('clip-manager-modal-title') as HTMLHeadingElement
  private readonly detailButtons = new Map<Clip, HTMLButtonElement>()
  private displayedClip: Clip | null = null
  private titleEditClip: Clip | null = null
  private titleEditStart = ''

  constructor() {
    this.openButton.onclick = () => this.open()
    this.deleteUnusedButton.onclick = () => void this.deleteUnusedClips()
    this.metadataBackButton.onclick = () => void this.hideMetadata()
    this.metadataTitle.addEventListener('dblclick', () => this.makeTitleEditable())
    this.metadataRenameButton.onclick = () => this.makeTitleEditable()
    this.metadataTitle.addEventListener('blur', () => void this.saveTitleChanges())
  }

  async open() {
    await this.refresh()
    document.getElementById('menu-dropdown')?.hidePopover()
    this.dialog.showModal()
  }

  private async refresh() {
    this.detailButtons.clear()
    const project = await ProjectManager.getActiveProject()
    const clips = project.getClips()
    const unusedClipCount = this.getUnusedClips(project).length
    this.deleteUnusedButton.disabled = unusedClipCount === 0
    this.deleteUnusedButton.innerText = `Delete unused clips${unusedClipCount > 0 ? ` (${unusedClipCount})` : ''}`
    this.listContainer.replaceChildren()

    if (clips.length === 0) {
      const emptyState = document.createElement('p')
      emptyState.innerText = 'No clips in this project yet.'
      this.listContainer.appendChild(emptyState)
      return
    }

    const clipRows = await Promise.all(clips.map((clip) => this.createClipRow(project, clip)))
    clipRows.forEach((row) => this.listContainer.appendChild(row))
  }

  private async deleteUnusedClips() {
    const project = await ProjectManager.getActiveProject()
    const unusedClips = this.getUnusedClips(project)
    if (unusedClips.length === 0) {
      await this.refresh()
      return
    }
    const noun = unusedClips.length === 1 ? 'clip' : 'clips'
    if (!globalThis.confirm(`Delete ${unusedClips.length} unused ${noun}? This cannot be undone.`)) {
      return
    }

    this.deleteUnusedButton.disabled = true
    editorHistory.clear()
    let deleted = false
    try {
      for (const clip of unusedClips) {
        await ProjectManager.deleteClip(clip)
      }
      deleted = true
    } catch (error) {
      NotificationsController.showError(error instanceof Error ? error : new Error(String(error)))
    } finally {
      await this.refresh()
    }
    if (deleted) {
      ;(this.listContainer.querySelector<HTMLElement>('.clip-manager-action-button') ?? this.titleElement).focus()
      announce(`Deleted ${unusedClips.length} unused ${noun}`)
    }
  }

  private async createClipRow(project: Project, clip: Clip): Promise<HTMLDivElement> {
    const row = document.createElement('div')
    row.className = 'clip-manager-row'

    const nameElement = document.createElement('div')
    nameElement.className = 'clip-manager-name'
    nameElement.innerText = clip.name

    const sizeElement = document.createElement('div')
    sizeElement.className = 'clip-manager-meta'
    sizeElement.innerText = humanizeBytes(await getClipDiskUsage(project, clip))

    const usedTrackCount = this.countTracksUsingClip(project, clip)
    const usageElement = document.createElement('div')
    usageElement.className = 'clip-manager-meta'
    usageElement.innerText = `used in ${usedTrackCount} track${usedTrackCount == 1 ? '' : 's'}`

    const actionsElement = document.createElement('div')
    actionsElement.className = 'clip-manager-actions'

    const metadataButton = document.createElement('button')
    metadataButton.className = 'bordered clickable clip-manager-action-button'
    metadataButton.type = 'button'
    metadataButton.innerText = 'View details'
    metadataButton.addEventListener('click', () => this.openClipInfo(clip))
    this.detailButtons.set(clip, metadataButton)

    const deleteButton = document.createElement('button')
    deleteButton.className = 'bordered clickable clip-manager-action-button clip-manager-delete-button'
    deleteButton.type = 'button'
    deleteButton.innerText = 'Delete clip'
    deleteButton.addEventListener('click', async () => {
      if (!globalThis.confirm(`Delete \"${clip.name}\"? This removes all uses from every track.`)) {
        return
      }
      const rowIndex = Array.from(this.listContainer.querySelectorAll('.clip-manager-row')).indexOf(row)
      deleteButton.disabled = true
      editorHistory.clear()
      await ProjectManager.deleteClip(clip)
      await this.refresh()
      const rows = this.listContainer.querySelectorAll('.clip-manager-row')
      if (rows.length > 0) {
        rows[Math.min(rowIndex, rows.length - 1)].querySelector<HTMLElement>('.clip-manager-delete-button')?.focus()
      } else {
        this.titleElement.focus()
      }
      announce(`Deleted clip ${clip.name}`)
    })

    actionsElement.append(metadataButton, deleteButton)
    row.append(nameElement, sizeElement, usageElement, actionsElement)
    return row
  }

  openClipInfo(clip: Clip) {
    this.metadataTitle.innerText = clip.name
    this.displayedClip = clip
    this.metadataList.replaceChildren()
    this.appendMetadata('Created', this.formatDate(clip.dateCreated))

    if (clip.sourceFilename) {
      this.appendMetadata('Filename', clip.sourceFilename)
    }
    for (const [name, value] of Object.entries(clip.tags ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
      this.appendMetadata(name, value)
    }
    if (this.dialog.open) {
      this.dialog.close()
    }
    this.metadataDialog.showModal()
  }

  private async hideMetadata() {
    await this.open()
    this.metadataDialog.close()
    if (this.displayedClip) this.detailButtons.get(this.displayedClip)?.focus()
  }

  private makeTitleEditable() {
    if (!this.displayedClip || this.metadataTitle.isContentEditable) {
      return
    }
    this.titleEditClip = this.displayedClip
    this.titleEditStart = this.displayedClip.name
    this.metadataTitle.contentEditable = 'true'
    this.metadataTitle.classList.add('clip-metadata-title-editing')
    this.metadataTitle.setAttribute('role', 'textbox')
    this.metadataTitle.setAttribute('aria-label', 'Clip name')
    this.metadataTitle.focus()
    this.metadataTitle.onkeydown = (event) => {
      if (event.key == 'Enter') {
        event.preventDefault()
        this.metadataTitle.blur()
        this.metadataRenameButton.focus()
      }
      if (event.key == 'Escape') {
        event.preventDefault()
        this.metadataTitle.innerText = this.titleEditStart
        this.metadataTitle.blur()
        this.metadataRenameButton.focus()
      }
    }
  }

  private async saveTitleChanges() {
    if (!this.metadataTitle.isContentEditable || !this.titleEditClip) {
      return
    }
    const clip = this.titleEditClip
    const oldName = this.titleEditStart
    const newName = this.metadataTitle.innerText.trim()
    this.metadataTitle.contentEditable = 'false'
    this.metadataTitle.classList.remove('clip-metadata-title-editing')
    this.metadataTitle.onkeydown = null
    this.metadataTitle.removeAttribute('role')
    this.metadataTitle.removeAttribute('aria-label')
    this.titleEditClip = null

    if (!newName || newName == oldName) {
      this.metadataTitle.innerText = oldName
      return
    }

    clip.name = newName
    this.metadataTitle.innerText = newName
    try {
      await ProjectManager.saveClip(clip)
      ;(window as any).trackListController?.draw?.()
    } catch (error) {
      clip.name = oldName
      this.metadataTitle.innerText = oldName
      NotificationsController.showError(error instanceof Error ? error : new Error(String(error)))
    }
  }

  private appendMetadata(name: string, value: string) {
    const label = document.createElement('dt')
    label.innerText = name
    const content = document.createElement('dd')
    content.innerText = value
    this.metadataList.append(label, content)
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

  private countTracksUsingClip(project: Project, clip: Clip): number {
    return project.getTracks().filter((track) => track.clipViews.some((clipView) => clipView.clip === clip)).length
  }

  private getUnusedClips(project: Project): Clip[] {
    const usedClips = new Set(project.getTracks().flatMap((track) => track.clipViews.map((clipView) => clipView.clip)))
    return project.getClips().filter((clip) => !usedClips.has(clip))
  }
}
