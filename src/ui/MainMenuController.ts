import { AudioControl, AudioState } from '../audiocontext/AudioControl'
import { editorHistory } from './undo/EditorHistory'

export class MainMenuController {
  private readonly menuDropdown = document.getElementById('menu-dropdown') as HTMLDivElement
  private readonly editSubmenu = document.getElementById('main-menu-edit-submenu') as HTMLDivElement
  private readonly editButton = document.getElementById('main-menu-edit-button') as HTMLButtonElement
  private readonly undoButton = document.getElementById('main-menu-undo-button') as HTMLButtonElement
  private readonly redoButton = document.getElementById('main-menu-redo-button') as HTMLButtonElement

  constructor() {
    this.editButton.onclick = () => this.setEditSubmenuOpen(true)
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
    await editorHistory.undo()
    this.close()
  }

  private async redo() {
    if (!this.canEdit()) {
      return
    }
    await editorHistory.redo()
    this.close()
  }

  private update() {
    const canEdit = this.canEdit()
    this.undoButton.innerText = editorHistory.undoActionString ? `Undo ${editorHistory.undoActionString}` : 'Undo'
    this.redoButton.innerText = editorHistory.redoActionString ? `Redo ${editorHistory.redoActionString}` : 'Redo'
    this.undoButton.disabled = !canEdit || !editorHistory.canUndo
    this.redoButton.disabled = !canEdit || !editorHistory.canRedo
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
