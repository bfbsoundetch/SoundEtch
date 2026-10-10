import { PointerStateManager } from './PointerStateManager'

export type ContextMenuTarget = { trackIndex: number; sample: number }

export class ContextMenuController {
  private static openMenu: ContextMenuController | null = null

  private readonly menu: HTMLDivElement
  private readonly items = new Array<HTMLButtonElement>()
  private readonly clickAwayListener = () => this.close(false)
  private returnFocus: HTMLElement | null = null
  private isOpen = false
  private trackIndex = -1
  private startingSample = -1

  constructor(
    id: string,
    label: string,
    private readonly pointerStateManager: PointerStateManager,
    ...entries: Array<ContextMenuItem | ContextMenuSeparator>
  ) {
    this.menu = document.createElement('div')
    this.menu.classList = 'context-menu'
    this.menu.id = id
    this.menu.setAttribute('role', 'menu')
    this.menu.setAttribute('aria-label', label)
    this.menu.tabIndex = -1
    document.body.appendChild(this.menu)
    this.menu.addEventListener('pointerdown', (e) => e.stopPropagation())
    this.menu.addEventListener('contextmenu', (e) => e.preventDefault())
    this.menu.addEventListener('focusout', (e) => {
      const next = e.relatedTarget
      if (!(next instanceof Node) || !this.menu.contains(next)) {
        this.close(false)
      }
    })
    this.menu.addEventListener('keydown', (e) => this.handleKeyDown(e))

    const unorderedList = document.createElement('ul')
    unorderedList.setAttribute('role', 'none')
    this.menu.appendChild(unorderedList)
    for (const entry of entries) {
      if (entry instanceof ContextMenuSeparator) {
        const separator = document.createElement('li')
        separator.setAttribute('role', 'separator')
        separator.className = 'context-menu-separator'
        unorderedList.appendChild(separator)
        continue
      }
      const itemElement = document.createElement('li')
      itemElement.setAttribute('role', 'none')
      const button = document.createElement('button')
      button.type = 'button'
      button.setAttribute('role', 'menuitem')
      button.tabIndex = -1
      button.className = 'context-menu-item'
      button.textContent = entry.label
      button.addEventListener('click', (ev) => {
        ev.stopPropagation()
        const trackIndex = this.trackIndex
        const sample = this.startingSample
        this.close(true)
        entry.onclick(trackIndex, sample)
      })
      this.items.push(button)
      itemElement.appendChild(button)
      unorderedList.appendChild(itemElement)
    }
  }

  draw(x: number, y: number, target?: ContextMenuTarget) {
    ContextMenuController.openMenu?.close(false)
    const active = document.activeElement
    this.returnFocus = active instanceof HTMLElement && active !== document.body ? active : null
    this.menu.style.display = 'block'

    // Position menu near cursor (but don't go off-screen)
    const finalX = Math.min(x, window.innerWidth - this.menu.offsetWidth - 5)
    const finalY = Math.min(y, window.innerHeight - this.menu.offsetHeight - 5)

    this.menu.style.left = finalX + 'px'
    this.menu.style.top = finalY + 'px'

    if (target) {
      this.trackIndex = target.trackIndex
      this.startingSample = target.sample
    } else {
      this.trackIndex = this.pointerStateManager.getActiveTrack()?.index ?? -1
      this.startingSample = this.pointerStateManager.getSampleForXValue(this.pointerStateManager.mouseXToSvgCoord(x))
    }

    document.addEventListener('pointerdown', this.clickAwayListener)
    this.isOpen = true
    ContextMenuController.openMenu = this
    this.items[0]?.focus()
  }

  close(restoreFocus: boolean) {
    if (!this.isOpen) {
      return
    }
    this.isOpen = false
    this.menu.style.display = 'none'
    document.removeEventListener('pointerdown', this.clickAwayListener)
    if (ContextMenuController.openMenu === this) {
      ContextMenuController.openMenu = null
    }
    const target = this.returnFocus
    this.returnFocus = null
    if (restoreFocus && target?.isConnected) {
      target.focus()
    }
  }

  remove() {
    this.close(false)
    this.menu.remove()
  }

  private handleKeyDown(event: KeyboardEvent) {
    if (this.items.length === 0) return
    const current = this.items.indexOf(document.activeElement as HTMLButtonElement)
    let next: number | null = null
    switch (event.key) {
      case 'ArrowDown':
        next = (current + 1) % this.items.length
        break
      case 'ArrowUp':
        next = current <= 0 ? this.items.length - 1 : current - 1
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = this.items.length - 1
        break
      case 'Escape':
      case 'Tab':
        event.preventDefault()
        event.stopPropagation()
        this.close(true)
        return
      default:
        return
    }
    event.preventDefault()
    this.items[next].focus()
  }
}

export class ContextMenuItem {
  constructor(
    readonly label: string,
    readonly onclick: (activeTrackIndex: number, startSample: number) => any,
  ) {}
}

export class ContextMenuSeparator {}
