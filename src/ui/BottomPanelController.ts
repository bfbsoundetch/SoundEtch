import { createArrowIcon, createSvgIcon } from './SvgIcon'

export type BottomPanelOptions = {
  owner: object
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
  private readonly resizeHandle = document.createElement('div')
  private readonly sizeButton = document.createElement('button')
  private readonly topElement = document.getElementById('topdiv')!
  private readonly applicationHeader = document.querySelector<HTMLElement>('.header-container')!
  private onBack: (() => Promise<void> | void) | null = null
  private onClose: (() => Promise<void> | void) | null = null
  private owner: object | null = null
  private isOpen = false
  private expanded = false
  private cancelResize: (() => void) | null = null
  private refreshResize: (() => void) | null = null
  private returnFocus: HTMLElement | null = null

  private constructor() {
    this.root.id = 'bottom-panel'
    this.root.className = 'bottom-panel'
    this.root.inert = true
    this.root.setAttribute('role', 'region')
    this.root.setAttribute('aria-labelledby', 'bottom-panel-title')
    this.titleElement.id = 'bottom-panel-title'
    this.titleElement.tabIndex = -1

    const header = document.createElement('div')
    header.className = 'bottom-panel-header'

    this.resizeHandle.className = 'bottom-panel-resize-handle'
    this.resizeHandle.tabIndex = 0
    this.resizeHandle.title = 'Drag to switch between half and full height'
    this.resizeHandle.setAttribute('role', 'separator')
    this.resizeHandle.setAttribute('aria-label', 'Resize bottom panel')
    this.resizeHandle.setAttribute('aria-orientation', 'horizontal')
    this.resizeHandle.setAttribute('aria-controls', 'bottom-panel')
    this.resizeHandle.setAttribute('aria-valuemin', '0')
    this.resizeHandle.setAttribute('aria-valuemax', '100')
    this.resizeHandle.addEventListener('keydown', (event) => {
      if (!this.isOpen || event.altKey || event.ctrlKey || event.metaKey) {
        return
      }
      switch (event.key) {
        case 'ArrowUp':
        case 'End':
          this.expanded = true
          break
        case 'ArrowDown':
        case 'Home':
          this.expanded = false
          break
        default:
          return
      }
      this.cancelResize?.()
      this.resizePanel()
      event.preventDefault()
      event.stopPropagation()
    })
    header.addEventListener('pointerdown', (event) => {
      if (
        !this.isOpen ||
        event.button !== 0 ||
        !event.isPrimary ||
        (event.target instanceof Element && event.target.closest('button'))
      ) {
        return
      }
      this.cancelResize?.()
      event.preventDefault()
      event.stopPropagation()
      this.resizeHandle.focus({ preventScroll: true })
      const pointerId = event.pointerId
      const startY = event.clientY
      const startHeight = this.root.getBoundingClientRect().height
      const grabOffset = startY - (window.innerHeight - startHeight)
      let currentY = startY
      let expandOnRelease = this.expanded
      const refreshResize = () => this.resizePanel(window.innerHeight - currentY + grabOffset)
      header.setPointerCapture(pointerId)
      this.root.classList.add('resizing')
      // Freeze a running snap animation before following the pointer.
      this.resizePanel(startHeight)
      const resize = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return
        currentY = moveEvent.clientY
        const distance = startY - currentY
        // Keep the drag's intent independent of layout and release coordinates.
        expandOnRelease = Math.abs(distance) >= 24 ? distance > 0 : this.expanded
        refreshResize()
      }
      const stopResize = () => {
        this.cancelResize = null
        this.refreshResize = null
        // Flush the drag preview so the transition starts at its visible height.
        this.root.getBoundingClientRect()
        this.root.classList.remove('resizing')
        window.removeEventListener('pointermove', resize, true)
        window.removeEventListener('pointerup', finishResize, true)
        window.removeEventListener('pointercancel', finishResize, true)
        window.removeEventListener('blur', stopResize)
        if (header.hasPointerCapture(pointerId)) header.releasePointerCapture(pointerId)
        this.resizePanel()
      }
      const finishResize = (endEvent: PointerEvent) => {
        if (endEvent.pointerId !== pointerId) return
        if (endEvent.type === 'pointerup') this.expanded = expandOnRelease
        stopResize()
      }
      this.cancelResize = stopResize
      this.refreshResize = refreshResize
      // Capture loss on the moving header must not discard the eventual release.
      window.addEventListener('pointermove', resize, true)
      window.addEventListener('pointerup', finishResize, true)
      window.addEventListener('pointercancel', finishResize, true)
      window.addEventListener('blur', stopResize)
    })

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
    this.closeButton.setAttribute('aria-label', 'Close panel')
    const closeIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    closeIcon.setAttribute('viewBox', '0 0 500 500')
    closeIcon.setAttribute('aria-hidden', 'true')
    const closeUse = document.createElementNS('http://www.w3.org/2000/svg', 'use')
    closeUse.setAttributeNS('http://www.w3.org/1999/xlink', 'href', '#menu-close')
    closeIcon.appendChild(closeUse)
    this.closeButton.appendChild(closeIcon)
    this.closeButton.addEventListener('click', () => this.close())

    this.sizeButton.type = 'button'
    this.sizeButton.className = 'clickable bottom-panel-size'
    this.sizeButton.append(
      createSvgIcon('panel-expand', { className: 'bottom-panel-expand-icon' }),
      createSvgIcon('panel-restore', { className: 'bottom-panel-restore-icon' }),
    )
    this.sizeButton.addEventListener('click', () => {
      this.expanded = !this.expanded
      this.cancelResize?.()
      this.resizePanel()
    })

    // Adjacent buttons share one divider, so the header's flex gap must not separate them.
    const headerButtons = document.createElement('div')
    headerButtons.className = 'bottom-panel-header-buttons'
    headerButtons.append(this.sizeButton, this.closeButton)

    header.append(this.resizeHandle, this.backButton, headingGroup, headerButtons)

    this.bodyElement.className = 'bottom-panel-body'
    this.root.append(header, this.bodyElement)
    document.body.appendChild(this.root)

    const updateLayout = () => {
      if (this.refreshResize) {
        this.refreshResize()
      } else {
        this.resizePanel(undefined, true)
      }
    }
    window.addEventListener('resize', updateLayout)
    new ResizeObserver(updateLayout).observe(this.applicationHeader)
  }

  open(options: BottomPanelOptions) {
    const previousFocus =
      document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement
        : null
    const focusWasInside = previousFocus !== null && this.root.contains(previousFocus)
    const opening = !this.isOpen || this.owner !== options.owner
    if (this.isOpen && this.owner !== options.owner) {
      this.close()
    }
    this.owner = options.owner
    this.onBack = options.onBack ?? null
    this.onClose = options.onClose
    this.backButton.disabled = false
    this.backButton.hidden = !this.onBack
    this.setTitle(options.title)
    this.setSubtitle(options.subtitle)
    this.setBody(options.body)
    this.root.classList.add('open')
    this.isOpen = true
    this.root.inert = false
    this.resizePanel()
    if (opening && !focusWasInside) {
      this.returnFocus = previousFocus
      this.titleElement.focus({ preventScroll: true })
    } else if (focusWasInside && !this.root.contains(document.activeElement)) {
      this.titleElement.focus({ preventScroll: true })
    }
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

  private resizePanel(requestedHeight?: number, immediate = false): void {
    if (!this.isOpen) return
    // Layout changes must not animate through or over the application header.
    if (immediate) this.root.classList.add('layout-resize')
    const viewportHeight = window.innerHeight
    const maximumHeight = Math.max(0, viewportHeight - this.applicationHeader.getBoundingClientRect().bottom)
    const minimumHeight = Math.min(viewportHeight / 2, maximumHeight)
    // Intermediate heights are only a drag preview, never retained panel state.
    const height =
      requestedHeight === undefined
        ? this.expanded
          ? maximumHeight
          : minimumHeight
        : Math.max(minimumHeight, Math.min(maximumHeight, requestedHeight))
    this.root.style.height = `${height}px`
    this.topElement.style.height = `${viewportHeight - height}px`
    this.root.classList.toggle('expanded', height === maximumHeight)
    this.resizeHandle.setAttribute('aria-valuenow', this.expanded ? '100' : '0')
    this.resizeHandle.setAttribute('aria-valuetext', this.expanded ? 'Full height' : 'Half height')
    const sizeLabel = this.expanded ? 'Restore half height' : 'Expand to full height'
    this.sizeButton.setAttribute('aria-label', sizeLabel)
    this.sizeButton.title = sizeLabel
    this.sizeButton.classList.toggle('expanded', this.expanded)
    if (immediate) {
      this.root.getBoundingClientRect()
      this.root.classList.remove('layout-resize')
    }
  }

  hide() {
    this.cancelResize?.()
    this.root.classList.remove('open')
    this.topElement.style.height = '100vh'
    this.isOpen = false
    this.root.inert = true
  }

  close(owner?: object): void {
    if (!this.isOpen || (owner !== undefined && owner !== this.owner)) {
      return
    }
    const restore = this.root.contains(document.activeElement)
    const target = this.returnFocus
    this.returnFocus = null
    this.hide()
    const onClose = this.onClose
    this.onBack = null
    this.onClose = null
    this.owner = null
    try {
      void Promise.resolve(onClose?.()).catch((error) => console.error('Bottom panel close action failed', error))
    } catch (error) {
      console.error('Bottom panel close action failed', error)
    }
    if (restore && target?.isConnected) target.focus()
  }
}
