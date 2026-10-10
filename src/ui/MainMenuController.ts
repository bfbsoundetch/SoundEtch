import { AudioControl, AudioState } from '../audiocontext/AudioControl'
import { editorHistory } from './undo/EditorHistory'
import { announce } from './LiveAnnouncer'

export class MainMenuController {
  private readonly menuDropdown = document.getElementById('menu-dropdown') as HTMLDivElement
  private readonly editSubmenu = document.getElementById('main-menu-edit-submenu') as HTMLDivElement
  private readonly editButton = document.getElementById('main-menu-edit-button') as HTMLButtonElement
  private readonly undoButton = document.getElementById('main-menu-undo-button') as HTMLButtonElement
  private readonly redoButton = document.getElementById('main-menu-redo-button') as HTMLButtonElement

  constructor() {
    this.editButton.onclick = () => this.setEditSubmenuOpen(this.editButton.getAttribute('aria-expanded') != 'true')
    this.editSubmenu.addEventListener('focusout', (event) => {
      if (!(event.relatedTarget instanceof Node && this.editSubmenu.contains(event.relatedTarget))) {
        this.setEditSubmenuOpen(false)
      }
    })
    this.editSubmenu.onmouseenter = () => this.setEditSubmenuOpen(true)
    this.editSubmenu.onmouseleave = () => this.setEditSubmenuOpen(false)
    this.undoButton.onclick = () => void this.undo()
    this.redoButton.onclick = () => void this.redo()

    this.menuDropdown.addEventListener('toggle', () => {
      this.update()
      if (!this.menuDropdown.matches(':popover-open')) {
        this.setEditSubmenuOpen(false)
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

  private setEditSubmenuOpen(open: boolean) {
    this.editSubmenu.classList.toggle('open', open)
    this.editButton.setAttribute('aria-expanded', String(open))
  }

  private close() {
    this.setEditSubmenuOpen(false)
    if (this.menuDropdown.matches(':popover-open')) {
      this.menuDropdown.hidePopover()
    }
  }

  private canEdit() {
    return AudioControl.getState() == AudioState.STOPPED || AudioControl.getState() == AudioState.MONITORING
  }
}
