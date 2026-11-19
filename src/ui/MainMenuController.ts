import { AudioControl, AudioState } from '../audiocontext/AudioControl'
import { ProjectManager } from '../project/ProjectManager'
import { editorHistory } from './undo/EditorHistory'
import { announce } from './LiveAnnouncer'

export class MainMenuController {
  private readonly menuDropdown = document.getElementById('menu-dropdown') as HTMLDivElement
  private readonly undoButton = document.getElementById('main-menu-undo-button') as HTMLButtonElement
  private readonly redoButton = document.getElementById('main-menu-redo-button') as HTMLButtonElement
  private readonly feedbackButton = document.getElementById('open-feedback-button') as HTMLButtonElement
  private openSubmenuButton: HTMLButtonElement | null = null
  private openedByHover = false

  constructor() {
    this.menuDropdown.querySelectorAll<HTMLButtonElement>('.main-menu-submenu-button').forEach((button) => {
      this.bindSubmenu(button)
    })
    const projectTitle = document.getElementById('main-menu-project-title') as HTMLDivElement
    void ProjectManager.addProjectListener((project) => {
      projectTitle.textContent = project.title
    })
    this.undoButton.onclick = () => void this.undo()
    this.redoButton.onclick = () => void this.redo()
    const configuredFeedbackUrl = import.meta.env.VITE_FEEDBACK_URL?.trim()
    let feedbackUrl: URL | undefined
    if (configuredFeedbackUrl) {
      try {
        const parsedUrl = new URL(configuredFeedbackUrl)
        if (
          parsedUrl.protocol === 'https:' ||
          (import.meta.env.DEV &&
            parsedUrl.protocol === 'http:' &&
            (parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1'))
        ) {
          feedbackUrl = parsedUrl
        }
      } catch {
        // Missing or invalid deployment configuration must not open a broken URL.
      }
    }
    this.feedbackButton.disabled = !feedbackUrl
    this.feedbackButton.title = feedbackUrl ? 'Opens in a new tab' : 'Feedback is not configured for this deployment.'
    if (feedbackUrl) {
      const url = feedbackUrl.href
      this.feedbackButton.onclick = () => {
        window.open(url, '_blank', 'noopener,noreferrer')
        this.close()
      }
    }

    this.menuDropdown.addEventListener('toggle', () => {
      this.update()
      if (!this.menuDropdown.matches(':popover-open')) {
        this.setOpenSubmenu(null)
      }
    })
    editorHistory.addChangeListener(() => this.update())
    AudioControl.addAudioControlListener(() => this.update())
    this.update()
  }

  private async undo() {
    if (!this.canEdit()) {
      return
    }
    const action = editorHistory.undoActionString
    await editorHistory.undo()
    if (action) announce(`Undid ${action}`)
    this.close()
  }

  private async redo() {
    if (!this.canEdit()) {
      return
    }
    const action = editorHistory.redoActionString
    await editorHistory.redo()
    if (action) announce(`Redid ${action}`)
    this.close()
  }

  private update() {
    const canEdit = this.canEdit()
    this.undoButton.replaceChildren(
      editorHistory.undoActionString ? `Undo ${editorHistory.undoActionString}` : 'Undo',
      this.createShortcut('Ctrl/⌘+Z'),
    )
    this.redoButton.replaceChildren(
      editorHistory.redoActionString ? `Redo ${editorHistory.redoActionString}` : 'Redo',
      this.createShortcut('Ctrl/⌘+Shift+Z'),
    )
    this.undoButton.disabled = !canEdit || !editorHistory.canUndo
    this.redoButton.disabled = !canEdit || !editorHistory.canRedo
  }

  private createShortcut(text: string) {
    const shortcut = document.createElement('kbd')
    shortcut.className = 'menu-item-shortcut'
    shortcut.setAttribute('aria-hidden', 'true')
    shortcut.textContent = text
    return shortcut
  }

  private bindSubmenu(button: HTMLButtonElement) {
    const submenu = button.parentElement!
    button.onclick = () => {
      this.setOpenSubmenu(this.openSubmenuButton == button && !this.openedByHover ? null : button)
    }
    submenu.addEventListener('pointerenter', (event) => {
      if (event.pointerType == 'mouse' && this.openSubmenuButton != button) {
        this.setOpenSubmenu(button, true)
      }
    })
    submenu.addEventListener('pointerleave', (event) => {
      if (
        event.pointerType == 'mouse' &&
        this.openSubmenuButton == button &&
        this.openedByHover &&
        !submenu.contains(document.activeElement)
      ) {
        this.setOpenSubmenu(null)
      }
    })
    submenu.addEventListener('focusout', (event) => {
      if (
        this.openSubmenuButton == button &&
        event.relatedTarget instanceof Node &&
        !submenu.contains(event.relatedTarget)
      ) {
        this.setOpenSubmenu(null)
      }
    })
  }

  private setOpenSubmenu(button: HTMLButtonElement | null, byHover = false) {
    if (this.openSubmenuButton != button) {
      this.openSubmenuButton?.setAttribute('aria-expanded', 'false')
      this.openSubmenuButton = button
      button?.setAttribute('aria-expanded', 'true')
    }
    this.openedByHover = byHover
  }

  private close() {
    this.setOpenSubmenu(null)
    if (this.menuDropdown.matches(':popover-open')) {
      this.menuDropdown.hidePopover()
    }
  }

  private canEdit() {
    return AudioControl.getState() == AudioState.STOPPED || AudioControl.getState() == AudioState.MONITORING
  }
}
