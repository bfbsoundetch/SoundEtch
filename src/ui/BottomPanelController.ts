import { editorHistory } from "./undo/EditorHistory"

export type BottomPanelOptions = {
  title: string
  subtitle: string
  body: HTMLElement
  onClose: () => void
}

export class BottomPanelController {

  private static instance: BottomPanelController | null = null

  static getInstance() {
    return this.instance ?? (this.instance = new BottomPanelController())
  }

  private readonly root = document.createElement('div')
  private readonly titleElement = document.createElement('h2')
  private readonly subtitleElement = document.createElement('div')
  private readonly bodyElement = document.createElement('div')
  private readonly closeButton = document.createElement('button')
  private onClose: (() => void) | null = null
  private isOpen = false

  private constructor() {
    this.root.id = 'bottom-panel'
    this.root.className = 'bottom-panel'

    const header = document.createElement('div')
    header.className = 'bottom-panel-header'

    const headingGroup = document.createElement('div')
    headingGroup.className = 'bottom-panel-heading'

    this.subtitleElement.className = 'bottom-panel-subtitle'
    headingGroup.append(this.titleElement, this.subtitleElement)

    this.closeButton.className = 'clickable bottom-panel-close'
    this.closeButton.type = 'button'
    this.closeButton.title = 'Close'
    this.closeButton.setAttribute('aria-label', 'Close effect panel')
    const closeIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    closeIcon.setAttribute('viewBox', '0 0 500 500')
    closeIcon.setAttribute('aria-hidden', 'true')
    const closeUse = document.createElementNS('http://www.w3.org/2000/svg', 'use')
    closeUse.setAttributeNS('http://www.w3.org/1999/xlink', 'href', '#menu-close')
    closeIcon.appendChild(closeUse)
    this.closeButton.appendChild(closeIcon)
    this.closeButton.addEventListener('click', () => this.close())

    header.append(headingGroup, this.closeButton)

    this.bodyElement.className = 'bottom-panel-body'
    this.root.append(header, this.bodyElement)
    document.body.appendChild(this.root)
  }

  open(options: BottomPanelOptions) {
    this.onClose = options.onClose
    this.setTitle(options.title)
    this.setSubtitle(options.subtitle)
    this.setBody(options.body)
    this.root.classList.add('open')
    this.isOpen = true
  }

  setTitle(title: string) {
    this.titleElement.textContent = title
  }

  setSubtitle(subtitle: string) {
    this.subtitleElement.textContent = subtitle
  }

  setBody(body: HTMLElement) {
    this.bodyElement.replaceChildren(body)
  }

  hide() {
    this.root.classList.remove('open')
    this.isOpen = false
  }

  close() {
    if (!this.isOpen) {
      return
    }
    this.hide()
    this.onClose?.()
    this.onClose = null
  }
}