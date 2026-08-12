import { Clip } from '../project/Clip'
import { Project } from '../project/Project'
import { ProjectManager } from '../project/ProjectManager'
import { getClipDiskUsage, humanizeBytes } from './DiskUsage'
import { editorHistory } from './undo/EditorHistory'

export class ClipManagerController {
  private readonly dialog = document.getElementById('clip-manager-modal') as HTMLDialogElement
  private readonly openButton = document.getElementById('open-clip-manager-modal-button') as HTMLButtonElement
  private readonly listContainer = document.getElementById('clip-manager-list') as HTMLDivElement
  private readonly metadataDialog = document.getElementById('clip-metadata-modal') as HTMLDialogElement
  private readonly metadataTitle = document.getElementById('clip-metadata-title') as HTMLHeadingElement
  private readonly metadataList = document.getElementById('clip-metadata-list') as HTMLDListElement
  private readonly metadataBackButton = document.getElementById('clip-metadata-back-button') as HTMLButtonElement

  constructor() {
    this.openButton.onclick = () => this.open()
    this.metadataBackButton.onclick = () => void this.hideMetadata()
  }

  async open() {
    await this.refresh()
    document.getElementById('menu-dropdown')?.hidePopover()
    this.dialog.showModal()
  }

  private async refresh() {
    const project = await ProjectManager.getActiveProject()
    const clips = project.getClips()
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
    metadataButton.className = 'menu-item clickable clip-manager-action-button'
    metadataButton.type = 'button'
    metadataButton.innerText = 'View details'
    metadataButton.addEventListener('click', () => this.openClipInfo(clip))

    const deleteButton = document.createElement('button')
    deleteButton.className = 'menu-item clickable clip-manager-action-button clip-manager-delete-button'
    deleteButton.type = 'button'
    deleteButton.innerText = 'Delete clip'
    deleteButton.addEventListener('click', async () => {
      if (!globalThis.confirm(`Delete \"${clip.name}\"? This removes all uses from every track.`)) {
        return
      }
      deleteButton.disabled = true
      editorHistory.clear()
      await ProjectManager.deleteClip(clip)
      await this.refresh()
    })

    actionsElement.append(metadataButton, deleteButton)
    row.append(nameElement, sizeElement, usageElement, actionsElement)
    return row
  }

  openClipInfo(clip: Clip) {
    this.metadataTitle.innerText = clip.name
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
}
