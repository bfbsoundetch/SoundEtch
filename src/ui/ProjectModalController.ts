import { AudioControl } from '../audiocontext/AudioControl'
import { Project } from '../project/Project'
import { ProjectManager } from '../project/ProjectManager'
import { humanizeBytes } from './DiskUsage'
import { NotificationsController } from './NotificationsController'
import { editorHistory } from './undo/EditorHistory'

export class ProjectModalController {
  private readonly dialog = document.getElementById('project-manager-modal') as HTMLDialogElement
  private readonly openButton = document.getElementById('open-project-manager-modal-button') as HTMLButtonElement
  private readonly newProjectButton = document.getElementById('project-manager-new-button') as HTMLButtonElement
  private readonly listContainer = document.getElementById('project-manager-list') as HTMLDivElement
  private projectIdToEditAfterRefresh: number | undefined = undefined

  constructor() {
    this.openButton.onclick = () => void this.open()
    this.newProjectButton.onclick = () => void this.createProject()
    void ProjectManager.addProjectListener(() => {
      if (this.dialog.open) {
        void this.refresh()
      }
    })
  }

  private async open() {
    try {
      await this.refresh()
      document.getElementById('menu-dropdown')?.hidePopover()
      this.dialog.showModal()
    } catch (error) {
      this.showError(error)
    }
  }

  private async refresh() {
    const activeProject = await ProjectManager.getActiveProject()
    const projects = await ProjectManager.getProjects()
    const projectIdToEdit = this.projectIdToEditAfterRefresh
    this.projectIdToEditAfterRefresh = undefined
    this.listContainer.replaceChildren()

    if (projects.length == 0) {
      const emptyState = document.createElement('p')
      emptyState.innerText = 'No projects yet.'
      this.listContainer.appendChild(emptyState)
      return
    }

    await Promise.all(
      projects.map((project) => this.appendProjectRow(project, project.id == activeProject.id, project.id == projectIdToEdit)),
    )
  }

  private async appendProjectRow(
    project: Project,
    isActiveProject: boolean,
    editImmediately: boolean,
  ) {
    const row = document.createElement('div')
    row.className = isActiveProject ? 'project-manager-row project-manager-row-active' : 'project-manager-row'

    const nameElement = document.createElement('div')
    nameElement.className = 'project-manager-name'
    const titleElement = document.createElement('div')
    titleElement.className = 'project-manager-title-text'
    titleElement.innerText = project.title
    nameElement.appendChild(titleElement)
    if (isActiveProject) {
      const activeLabel = document.createElement('span')
      activeLabel.className = 'project-manager-active-label'
      activeLabel.innerText = 'Current'
      nameElement.appendChild(activeLabel)
    }
    let titleEditStart = project.title
    titleElement.addEventListener('dblclick', () => {
      titleEditStart = project.title
      this.makeEditable(titleElement)
    })
    titleElement.addEventListener('blur', () => void this.saveTitleChanges(titleElement, project, titleEditStart))

    const metaGrid = document.createElement('div')
    metaGrid.className = 'project-manager-meta-grid'
    metaGrid.append(
      this.createMetaElement('Size on disk', humanizeBytes(await ProjectManager.getProjectDiskUsage(project))),
      this.createMetaElement('Created', this.formatDate(project.dateCreated)),
      this.createMetaElement('Modified', this.formatDate(ProjectManager.getProjectModifiedDate(project))),
    )

    const actionsElement = document.createElement('div')
    actionsElement.className = 'project-manager-actions'

    const openButton = document.createElement('button')
    openButton.className = 'menu-item clickable project-manager-action-button'
    openButton.innerText = isActiveProject ? 'Open' : 'Open project'
    openButton.type = 'button'
    openButton.disabled = isActiveProject
    openButton.onclick = () => void this.openProject(project, openButton)

    const deleteButton = document.createElement('button')
    deleteButton.className = 'menu-item clickable project-manager-action-button project-manager-delete-button'
    deleteButton.innerText = 'Delete'
    deleteButton.type = 'button'
    deleteButton.onclick = () => void this.deleteProject(project, deleteButton)

    actionsElement.append(openButton, deleteButton)
    row.append(nameElement, metaGrid, actionsElement)

    this.listContainer.appendChild(row)

    if (editImmediately) {
      requestAnimationFrame(() => {
        titleEditStart = project.title
        this.makeEditable(titleElement)
        this.selectElementText(titleElement)
      })
    }
  }

  private createMetaElement(label: string, value: string): HTMLDivElement {
    const element = document.createElement('div')
    element.className = 'project-manager-meta'

    const labelElement = document.createElement('span')
    labelElement.className = 'project-manager-meta-label'
    labelElement.innerText = label

    const valueElement = document.createElement('span')
    valueElement.innerText = value

    element.append(labelElement, valueElement)
    return element
  }

  private async openProject(project: Project, button: HTMLButtonElement) {
    try {
      button.disabled = true
      await AudioControl.stop()
      editorHistory.clear()
      await ProjectManager.openProject(project)
      this.dialog.close()
    } catch (error) {
      this.showError(error)
      button.disabled = false
    }
  }

  private async createProject() {
    try {
      this.newProjectButton.disabled = true
      const activeProject = await ProjectManager.getActiveProject()
      const title = this.getNewProjectTitle(await ProjectManager.getProjects())
      await AudioControl.stop()
      editorHistory.clear()
      const project = await ProjectManager.createProject(title, activeProject.sampleRate)
      this.projectIdToEditAfterRefresh = project.id
    } catch (error) {
      this.showError(error)
    } finally {
      this.newProjectButton.disabled = false
    }
  }

  private async deleteProject(project: Project, button: HTMLButtonElement) {
    if (!globalThis.confirm(`Delete "${project.title}"? This removes the project, its clips, and its audio files.`)) {
      return
    }

    try {
      button.disabled = true
      const activeProject = await ProjectManager.getActiveProject()
      if (project.id == activeProject.id) {
        await AudioControl.stop()
        editorHistory.clear()
      }
      await ProjectManager.deleteProject(project)
    } catch (error) {
      this.showError(error)
      button.disabled = false
    }
  }

  private makeEditable(element: HTMLElement) {
    element.contentEditable = 'true'
    element.classList.add('project-manager-title-editing')
    element.focus()
    element.onkeydown = (event) => {
      if (event.key == 'Enter') {
        event.preventDefault()
        element.blur()
      }
      if (event.key == 'Escape') {
        event.preventDefault()
        element.innerText = element.dataset.editStart ?? element.innerText
        element.blur()
      }
    }
    element.dataset.editStart = element.innerText
  }

  private async saveTitleChanges(element: HTMLElement, project: Project, oldTitle: string) {
    if (!element.isContentEditable) {
      return
    }
    element.contentEditable = 'false'
    element.classList.remove('project-manager-title-editing')
    element.onkeydown = null
    delete element.dataset.editStart

    const newTitle = element.innerText.trim()
    if (!newTitle) {
      element.innerText = oldTitle
      return
    }
    element.innerText = newTitle
    if (newTitle == oldTitle) {
      return
    }

    try {
      await ProjectManager.renameProject(project, newTitle)
    } catch (error) {
      element.innerText = oldTitle
      this.showError(error)
    }
  }

  private selectElementText(element: HTMLElement) {
    const selection = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(element)
    selection?.removeAllRanges()
    selection?.addRange(range)
  }

  private getNewProjectTitle(projects: Project[]): string {
    const baseTitle = 'Untitled Project'
    const existingTitles = new Set(projects.map((project) => project.title))
    if (!existingTitles.has(baseTitle)) {
      return baseTitle
    }
    for (let i = 2; ; ++i) {
      const title = `${baseTitle} ${i}`
      if (!existingTitles.has(title)) {
        return title
      }
    }
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

  private showError(error: unknown) {
    NotificationsController.showError(error instanceof Error ? error : new Error(String(error)))
  }
}
