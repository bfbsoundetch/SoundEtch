import { PointerStateManager } from './PointerStateManager'

export class ContextMenuController {
  private readonly menu: HTMLDivElement
  private readonly clickAwayListener = (event: MouseEvent) => {
    this.menu.style.display = 'none'
    document.removeEventListener('pointerdown', this.clickAwayListener)
    event.stopPropagation()
  }
  private trackIndex = -1
  private startingSample = -1

  constructor(
    id: string,
    private readonly pointerStateManager: PointerStateManager,
    ...items: Array<ContextMenuItem>
  ) {
    this.menu = document.createElement('div')
    this.menu.classList = 'context-menu'
    this.menu.id = id
    document.body.appendChild(this.menu)
    this.menu.addEventListener('pointerdown', (e) => e.stopPropagation())

    const unorderedList = document.createElement('ul')
    this.menu.appendChild(unorderedList)
    for (const item of items) {
      const itemElement = document.createElement('li')
      const itemDiv = document.createElement('div')
      itemDiv.classList = item.enabled ? 'context-menu-item-enabled' : 'context-menu-item-disabled'
      itemDiv.innerText = item.label
      itemDiv.onclick = (ev: MouseEvent) => {
        if (!item.enabled) {
          return
        }
        this.clickAwayListener(ev)
        item.onclick(this.trackIndex, this.startingSample)
        ev.stopPropagation()
      }
      itemElement.appendChild(itemDiv)
      unorderedList.appendChild(itemElement)
    }
  }

  draw(x: number, y: number) {
    document.addEventListener('pointerdown', this.clickAwayListener)
    this.menu.style.display = 'block'

    // Position menu near cursor (but don't go off-screen)
    const finalX = Math.min(x, window.innerWidth - this.menu.offsetWidth - 5)
    const finalY = Math.min(y, window.innerHeight - this.menu.offsetHeight - 5)

    this.menu.style.left = finalX + 'px'
    this.menu.style.top = finalY + 'px'

    this.trackIndex = this.pointerStateManager.getActiveTrack()?.index ?? -1
    this.startingSample = this.pointerStateManager.getSampleForXValue(this.pointerStateManager.mouseXToSvgCoord(x))
  }

  remove() {
    this.menu.remove()
  }
}

export class ContextMenuItem {
  constructor(
    readonly label: string,
    readonly onclick: (activeTrackIndex: number, startSample: number) => any,
    public enabled = true,
  ) {}
}
