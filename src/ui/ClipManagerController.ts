import { Clip } from '../project/Clip'
import { Project } from '../project/Project'
import { ProjectManager } from '../project/ProjectManager'
import { getClipDiskUsage, humanizeBytes } from './DiskUsage'
import { editorHistory } from './undo/EditorHistory'

export class ClipManagerController {
  private readonly dialog = document.getElementById('clip-manager-modal') as HTMLDialogElement
  private readonly openButton = document.getElementById('open-clip-manager-modal-button') as HTMLButtonElement
  private readonly listContainer = document.getElementById('clip-manager-list') as HTMLDivElement

  constructor() {
    this.openButton.onclick = () => this.open()
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

    const deleteButton = document.createElement('button')
    deleteButton.className = 'menu-item clickable clip-manager-delete-button'
    deleteButton.innerText = 'Delete clip'
    deleteButton.onclick = async () => {
      if (!globalThis.confirm(`Delete \"${clip.name}\"? This removes all uses from every track.`)) {
        return
      }
      deleteButton.disabled = true
      editorHistory.clear()
      await ProjectManager.deleteClip(clip)
      await this.refresh()
    }

    row.append(nameElement, sizeElement, usageElement, deleteButton)
    return row
  }

  private countTracksUsingClip(project: Project, clip: Clip): number {
    return project.getTracks().filter((track) => track.clipViews.some((clipView) => clipView.clip === clip)).length
  }
}
