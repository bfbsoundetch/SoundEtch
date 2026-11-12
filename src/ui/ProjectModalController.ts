import { Recorder } from '../recording/Recorder'
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
  private pendingFocus: { projectId?: number; rowIndex: number; selector: string } | null = null
  private static readonly ROW_BUTTON_SELECTORS = [
    '.project-manager-open-button',
    '.project-manager-rename-button',
    '.project-manager-delete-button',
  ]

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
    this.capturePendingFocus()
    const activeProject = await ProjectManager.getActiveProject()
    const projects = await ProjectManager.getProjects()
    const projectIdToEdit = this.projectIdToEditAfterRefresh
    this.projectIdToEditAfterRefresh = undefined
    this.listContainer.replaceChildren()

    if (projects.length == 0) {
      const emptyState = document.createElement('p')
      emptyState.innerText = 'No projects yet.'
      this.listContainer.appendChild(emptyState)
      this.restorePendingFocus()
      return
    }

    await Promise.all(
      projects.map((project) =>
        this.appendProjectRow(project, project.id == activeProject.id, project.id == projectIdToEdit),
      ),
    )
    this.restorePendingFocus()
  }

  private capturePendingFocus() {
    const focused = document.activeElement
    if (this.pendingFocus !== null || !(focused instanceof HTMLElement) || !this.listContainer.contains(focused)) {
      return
    }
    const row = focused.closest<HTMLElement>('.project-manager-row')
    const selector = ProjectModalController.ROW_BUTTON_SELECTORS.find((s) => focused.matches(s))
    if (!row || !selector) {
      return
    }
    const projectId = row.dataset.projectId === undefined ? undefined : Number(row.dataset.projectId)
    this.pendingFocus = { projectId, rowIndex: Array.from(this.listContainer.children).indexOf(row), selector }
  }

  private restorePendingFocus() {
    const pending = this.pendingFocus
    this.pendingFocus = null
    if (!pending) {
      return
    }
    const rows = Array.from(this.listContainer.querySelectorAll<HTMLElement>('.project-manager-row'))
    let row =
      pending.projectId === undefined ? undefined : rows.find((r) => r.dataset.projectId == String(pending.projectId))
    if (!row && rows.length > 0) {
      row = rows[Math.min(Math.max(pending.rowIndex, 0), rows.length - 1)]
    }
    if (!row) {
      this.newProjectButton.focus()
      return
    }
    let target = row.querySelector<HTMLButtonElement>(pending.selector)
    if (!target || target.disabled) {
      target = row.querySelector<HTMLButtonElement>('button:not(:disabled)')
    }
    target?.focus()
  }

  private async appendProjectRow(project: Project, isActiveProject: boolean, editImmediately: boolean) {
    const row = document.createElement('div')
    row.className = isActiveProject ? 'project-manager-row project-manager-row-active' : 'project-manager-row'
    row.dataset.projectId = String(project.id)

    const nameElement = document.createElement('div')
    nameElement.className = 'project-manager-name'
    const titleElement = document.createElement('div')
    titleElement.className = 'project-manager-title-text'
    titleElement.id = `project-title-${project.id}`
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
    openButton.className = 'bordered clickable project-manager-action-button project-manager-open-button'
    openButton.innerText = isActiveProject ? 'Open' : 'Open project'
    openButton.type = 'button'
    openButton.disabled = isActiveProject
    openButton.onclick = () => void this.openProject(project, openButton)
    openButton.setAttribute('aria-describedby', titleElement.id)

    const renameButton = document.createElement('button')
    renameButton.className = 'bordered clickable project-manager-action-button project-manager-rename-button'
    renameButton.type = 'button'
    renameButton.innerText = 'Rename'
    renameButton.setAttribute('aria-describedby', titleElement.id)
    renameButton.onclick = () => {
      titleEditStart = project.title
      this.makeEditable(titleElement)
      this.selectElementText(titleElement)
    }

    const deleteButton = document.createElement('button')
    deleteButton.className = 'bordered clickable project-manager-action-button project-manager-delete-button'
    deleteButton.innerText = 'Delete'
    deleteButton.type = 'button'
    deleteButton.setAttribute('aria-describedby', titleElement.id)
    deleteButton.onclick = () => void this.deleteProject(project, deleteButton)

    actionsElement.append(openButton, renameButton, deleteButton)
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
      await Recorder.stopAndWaitForRecordings()
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
      await Recorder.stopAndWaitForRecordings()
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
      const row = button.closest('.project-manager-row')
      this.pendingFocus = {
        rowIndex: row ? Array.from(this.listContainer.children).indexOf(row) : 0,
        selector: '.project-manager-delete-button',
      }
      button.disabled = true
      const activeProject = await ProjectManager.getActiveProject()
      const isActive = project.id == activeProject.id
      if (isActive) {
        await Recorder.stopAndWaitForRecordings()
        editorHistory.clear()
      }
      await ProjectManager.deleteProject(project)
      if (!isActive) {
        await this.refresh()
      }
    } catch (error) {
      this.pendingFocus = null
      this.showError(error)
      button.disabled = false
    }
  }

  private makeEditable(element: HTMLElement) {
    element.contentEditable = 'true'
    element.classList.add('project-manager-title-editing')
    element.setAttribute('role', 'textbox')
    element.setAttribute('aria-label', 'Project name')
    element.focus()
    element.onkeydown = (event) => {
      if (event.key != 'Enter' && event.key != 'Escape') {
        return
      }
      event.preventDefault()
      if (event.key == 'Escape') {
        element.innerText = element.dataset.editStart ?? element.innerText
      }
      element.blur()
      element.closest('.project-manager-row')?.querySelector<HTMLElement>('.project-manager-rename-button')?.focus()
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
    element.removeAttribute('role')
    element.removeAttribute('aria-label')
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
