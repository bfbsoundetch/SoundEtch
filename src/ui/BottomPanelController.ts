import { createArrowIcon } from './SvgIcon'

export type BottomPanelOptions = {
  title: string
  subtitle: string
  body: HTMLElement
  onBack?: () => Promise<void> | void
  onClose: () => Promise<void> | void
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
  private readonly backButton = document.createElement('button')
  private readonly closeButton = document.createElement('button')
  private onBack: (() => Promise<void> | void) | null = null
  private onClose: (() => Promise<void> | void) | null = null
  private isOpen = false

  private constructor() {
    this.root.id = 'bottom-panel'
    this.root.className = 'bottom-panel'

    const header = document.createElement('div')
    header.className = 'bottom-panel-header'

    const headingGroup = document.createElement('div')
    headingGroup.className = 'bottom-panel-heading'

    this.backButton.className = 'clickable bottom-panel-back'
    this.backButton.type = 'button'
    this.backButton.title = 'Back'
    this.backButton.setAttribute('aria-label', 'Back')
    this.backButton.appendChild(createArrowIcon('line', { className: 'bottom-panel-back-icon' }))
    this.backButton.hidden = true
    this.backButton.addEventListener('click', () => {
      const onBack = this.onBack
      if (!onBack || this.backButton.disabled) {
        return
      }
      this.backButton.disabled = true
      try {
        void Promise.resolve(onBack())
          .catch((error) => console.error('Bottom panel back action failed', error))
          .finally(() => {
            this.backButton.disabled = false
          })
      } catch (error) {
        this.backButton.disabled = false
        console.error('Bottom panel back action failed', error)
      }
    })

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

    header.append(this.backButton, headingGroup, this.closeButton)

    this.bodyElement.className = 'bottom-panel-body'
    this.root.append(header, this.bodyElement)
    document.body.appendChild(this.root)
  }

  open(options: BottomPanelOptions) {
    this.onBack = options.onBack ?? null
    this.onClose = options.onClose
    this.backButton.disabled = false
    this.backButton.hidden = !this.onBack
    this.setTitle(options.title)
    this.setSubtitle(options.subtitle)
    this.setBody(options.body)
    this.root.classList.add('open')
    document.getElementById('topdiv')!.style.height = '50vh'
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
    document.getElementById('topdiv')!.style.height = '100vh'
    this.isOpen = false
  }

  close() {
    if (!this.isOpen) {
      return
    }
    this.hide()
    const onClose = this.onClose
    this.onBack = null
    this.onClose = null
    try {
      void Promise.resolve(onClose?.()).catch((error) => console.error('Bottom panel close action failed', error))
    } catch (error) {
      console.error('Bottom panel close action failed', error)
    }
  }
}
