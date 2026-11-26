import { createArrowIcon, createSvgIcon } from './SvgIcon'

export type TopPanelTabId = 'inputs' | 'tracks' | 'output'

export type TopPanelOptions = {
  tab: TopPanelTabId
  owner: object
  /** A view without a title or back action has no heading row. */
  title?: string
  subtitle?: string
  body: HTMLElement
  onBack?: () => Promise<void> | void
  /** Runs when another view replaces this one or its owner closes it. */
  onClose?: () => Promise<void> | void
}

type PanelSize = 'collapsed' | 'half' | 'full'
type OpenPanelSize = Exclude<PanelSize, 'collapsed'>

const PANEL_SIZES: readonly PanelSize[] = ['collapsed', 'half', 'full']
const TAB_IDS: readonly TopPanelTabId[] = ['inputs', 'tracks', 'output']
const TAB_LABELS: Record<TopPanelTabId, string> = { inputs: 'Inputs', tracks: 'Tracks', output: 'Output' }
// Smaller drags keep the current size.
const SNAP_DISTANCE = 24

/** One tab's header button and panel, holding the view of whichever owner put one there last. */
class TopPanelTab {
  readonly button = document.createElement('button')
  readonly panel = document.createElement('section')
  readonly visibilityListeners = new Array<(visible: boolean) => void>()
  readonly activationListeners = new Array<() => void>()
  owner: object | null = null
  restoreRoot: (() => void) | null = null
  visible = false
  private readonly heading = document.createElement('div')
  private readonly backButton = document.createElement('button')
  private readonly titleElement = document.createElement('h2')
  private readonly subtitleElement = document.createElement('div')
  private readonly body = document.createElement('div')
  private onBack: (() => Promise<void> | void) | null = null
  private onClose: (() => Promise<void> | void) | null = null

  constructor(readonly id: TopPanelTabId) {
    const panelId = `top-panel-${id}`
    this.button.type = 'button'
    this.button.id = `${panelId}-tab`
    this.button.className = 'clickable top-panel-tab'
    this.button.textContent = TAB_LABELS[id]
    this.button.setAttribute('role', 'tab')
    this.button.setAttribute('aria-controls', panelId)

    this.panel.id = panelId
    this.panel.className = 'top-panel-tab-panel'
    this.panel.tabIndex = -1
    this.panel.setAttribute('role', 'tabpanel')
    this.panel.setAttribute('aria-labelledby', this.button.id)

    this.backButton.className = 'clickable top-panel-back'
    this.backButton.type = 'button'
    this.backButton.title = 'Back'
    this.backButton.setAttribute('aria-label', 'Back')
    this.backButton.appendChild(createArrowIcon('line', { className: 'top-panel-back-icon' }))
    this.backButton.addEventListener('click', () => {
      const onBack = this.onBack
      if (!onBack || this.backButton.disabled) {
        return
      }
      this.backButton.disabled = true
      try {
        void Promise.resolve(onBack())
          .catch((error) => console.error('Top panel back action failed', error))
          .finally(() => {
            this.backButton.disabled = false
          })
      } catch (error) {
        this.backButton.disabled = false
        console.error('Top panel back action failed', error)
      }
    })

    this.titleElement.id = `${panelId}-title`
    this.titleElement.tabIndex = -1
    this.subtitleElement.className = 'top-panel-subtitle'
    const headingText = document.createElement('div')
    headingText.className = 'top-panel-heading-text'
    headingText.append(this.titleElement, this.subtitleElement)
    this.heading.className = 'top-panel-view-heading'
    this.heading.hidden = true
    this.heading.append(this.backButton, headingText)

    this.body.className = 'top-panel-view-body'
    this.panel.append(this.heading, this.body)
  }

  show(options: TopPanelOptions): void {
    this.owner = options.owner
    this.onBack = options.onBack ?? null
    this.onClose = options.onClose ?? null
    this.backButton.disabled = false
    this.backButton.hidden = !this.onBack
    this.titleElement.textContent = options.title ?? ''
    this.subtitleElement.textContent = options.subtitle ?? ''
    this.heading.hidden = !options.title && !this.onBack
    // Re-showing the same view must not detach it, which would drop focus inside it.
    if (this.body.firstElementChild !== options.body) this.body.replaceChildren(options.body)
  }

  setSubtitle(subtitle: string): void {
    this.subtitleElement.textContent = subtitle
  }

  setBody(body: HTMLElement): void {
    this.body.replaceChildren(body)
  }

  /** Detaches the current view and runs its owner's teardown. */
  release(): void {
    const onClose = this.onClose
    this.owner = null
    this.onBack = null
    this.onClose = null
    this.heading.hidden = true
    this.body.replaceChildren()
    try {
      void Promise.resolve(onClose?.()).catch((error) => console.error('Top panel close action failed', error))
    } catch (error) {
      console.error('Top panel close action failed', error)
    }
  }

  focusView(): void {
    ;(this.heading.hidden ? this.panel : this.titleElement).focus({ preventScroll: true })
  }
}

/**
 * The tabbed panel docked above the timeline, hidden while the welcome screen is showing.
 * It starts minimized; dragging downward or using its buttons switches between minimized, half and full height.
 */
export class TopPanelController {
  private static instance: TopPanelController | null = null

  static getInstance() {
    return this.instance ?? (this.instance = new TopPanelController())
  }

  private readonly root = document.createElement('div')
  private readonly tabList = document.createElement('div')
  private readonly body = document.createElement('div')
  private readonly decreaseButton = document.createElement('button')
  private readonly footer = document.createElement('div')
  private readonly increaseButton = document.createElement('button')
  private readonly topElement = document.getElementById('topdiv')!
  private readonly timelineElement = document.getElementById('timeline-body')!
  private readonly applicationHeader = document.querySelector<HTMLElement>('.header-container')!
  private readonly tabs = Object.fromEntries(TAB_IDS.map((id) => [id, new TopPanelTab(id)])) as Record<
    TopPanelTabId,
    TopPanelTab
  >
  private activeTab: TopPanelTabId = 'tracks'
  private size: PanelSize = 'collapsed'
  private openSize: OpenPanelSize = 'half'
  private bodyShowing = false
  private cancelResize: (() => void) | null = null
  private refreshResize: (() => void) | null = null
  private suppressHandleClick = false

  private constructor() {
    this.root.id = 'top-panel'
    this.root.className = 'top-panel collapsed'
    this.root.hidden = true
    this.root.setAttribute('role', 'region')
    this.root.setAttribute('aria-label', 'Top panel')

    for (const button of [this.decreaseButton, this.increaseButton]) {
      button.type = 'button'
      button.className = 'clickable top-panel-size-button'
      button.setAttribute('aria-controls', 'top-panel-body')
      const label = button === this.decreaseButton ? 'Decrease panel height' : 'Increase panel height'
      button.setAttribute('aria-label', label)
      button.title = `${label}. Drag to resize.`
      button.setAttribute(
        'aria-description',
        'Drag to resize. Arrow Down expands one step; Arrow Up shrinks. Home minimizes; End expands to full height.',
      )
      const chevron = createSvgIcon('chevron-down', { className: 'top-panel-size-icon' })
      chevron.setAttribute('viewBox', '0 0 500 125')
      button.appendChild(chevron)
      button.addEventListener('click', (event) => {
        // Pointer drags must not also activate the button; keyboard and assistive clicks still work.
        const suppress = this.suppressHandleClick && event.detail !== 0
        this.suppressHandleClick = false
        if (suppress) return
        const index = PANEL_SIZES.indexOf(this.size)
        const step = button === this.decreaseButton ? -1 : 1
        this.setSize(PANEL_SIZES[Math.max(0, Math.min(PANEL_SIZES.length - 1, index + step))])
      })
      button.addEventListener('keydown', (event) => {
        if (event.altKey || event.ctrlKey || event.metaKey) {
          return
        }
        const index = PANEL_SIZES.indexOf(this.size)
        switch (event.key) {
          case 'ArrowDown':
            this.setSize(PANEL_SIZES[Math.min(index + 1, PANEL_SIZES.length - 1)])
            break
          case 'ArrowUp':
            this.setSize(PANEL_SIZES[Math.max(index - 1, 0)])
            break
          case 'Home':
            this.setSize('collapsed')
            break
          case 'End':
            this.setSize('full')
            break
          default:
            return
        }
        event.preventDefault()
        event.stopPropagation()
      })
      button.addEventListener('pointerdown', (event) => this.startResize(event))
    }
    this.decreaseButton.classList.add('top-panel-decrease')
    this.increaseButton.classList.add('top-panel-increase')
    this.footer.addEventListener('pointerdown', (event) => this.startResize(event))

    this.tabList.className = 'top-panel-tabs'
    this.tabList.setAttribute('role', 'tablist')
    this.tabList.setAttribute('aria-label', 'Panel views')
    for (const tab of Object.values(this.tabs)) {
      tab.button.addEventListener('click', () => {
        this.activateTab(tab.id)
        if (this.size === 'collapsed') this.setSize(this.openSize)
      })
      this.tabList.appendChild(tab.button)
      this.body.appendChild(tab.panel)
    }
    this.tabList.addEventListener('keydown', (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey) {
        return
      }
      const index = TAB_IDS.indexOf(this.activeTab)
      let next: number
      switch (event.key) {
        case 'ArrowLeft':
          next = (index + TAB_IDS.length - 1) % TAB_IDS.length
          break
        case 'ArrowRight':
          next = (index + 1) % TAB_IDS.length
          break
        case 'Home':
          next = 0
          break
        case 'End':
          next = TAB_IDS.length - 1
          break
        default:
          return
      }
      this.activateTab(TAB_IDS[next])
      this.tabs[TAB_IDS[next]].button.focus()
      event.preventDefault()
      event.stopPropagation()
    })

    this.footer.className = 'top-panel-footer'
    const sizeControls = document.createElement('div')
    sizeControls.className = 'top-panel-size-controls'
    sizeControls.append(this.decreaseButton, this.increaseButton)
    this.footer.append(this.tabList, sizeControls)

    this.body.id = 'top-panel-body'
    this.body.className = 'top-panel-body'
    this.body.inert = true
    this.root.append(this.body, this.footer)
    this.topElement.insertBefore(this.root, this.applicationHeader.nextSibling)
    this.selectTab(this.activeTab)
    this.resizePanel(undefined, true)

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

  /** Hides the editor panel without changing its selected tab or size. */
  setHidden(hidden: boolean): void {
    if (this.root.hidden === hidden) return
    this.cancelResize?.()
    this.root.hidden = hidden
    if (!hidden) this.resizePanel(undefined, true)
    this.updateVisibility()
  }

  /** Puts a view in its tab, replacing another owner's view there; the selected tab and panel size stay. */
  open(options: TopPanelOptions): void {
    const tab = this.tabs[options.tab]
    const focusWasInside = tab.panel.contains(document.activeElement)
    if (tab.owner !== null && tab.owner !== options.owner) {
      tab.release()
    }
    tab.show(options)
    if (focusWasInside && !tab.panel.contains(document.activeElement)) tab.focusView()
  }

  /** Reveals a tab; an optional timeline anchor stays visible instead of reopening at full height. */
  reveal(id: TopPanelTabId, timelineAnchor?: Element): void {
    const focusWasOutside = !this.root.contains(document.activeElement)
    this.selectTab(id)
    if (this.size === 'collapsed') {
      this.setSize(timelineAnchor && this.openSize === 'full' ? 'half' : this.openSize)
    } else if (timelineAnchor && this.size === 'full') {
      this.setSize('half')
    }
    if (focusWasOutside) this.tabs[id].focusView()
    if (!timelineAnchor) return
    const scrollToAnchor = () => timelineAnchor.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    scrollToAnchor()
    const animations = this.root.getAnimations()
    if (animations.length === 0) return
    const resizeObserver = new ResizeObserver(scrollToAnchor)
    resizeObserver.observe(this.timelineElement)
    void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
      resizeObserver.disconnect()
      scrollToAnchor()
    })
  }

  /** Removes the owner's view; its tab goes back to the root view registered for it. */
  close(owner: object): void {
    const tab = this.tabOf(owner)
    if (!tab) {
      return
    }
    const focusWasInside = tab.panel.contains(document.activeElement)
    tab.release()
    tab.restoreRoot?.()
    if (focusWasInside && !tab.panel.contains(document.activeElement)) tab.focusView()
  }

  /** `restore` puts the tab's base view back whenever another view in that tab closes. */
  setRootView(id: TopPanelTabId, restore: () => void): void {
    this.tabs[id].restoreRoot = restore
  }

  setSubtitle(owner: object, subtitle: string): void {
    this.tabOf(owner)?.setSubtitle(subtitle)
  }

  setBody(owner: object, body: HTMLElement): void {
    this.tabOf(owner)?.setBody(body)
  }

  /** Whether the tab is selected and the panel's content area is open. */
  isVisible(id: TopPanelTabId): boolean {
    return this.tabs[id].visible
  }

  addVisibilityListener(id: TopPanelTabId, listener: (visible: boolean) => void): void {
    this.tabs[id].visibilityListeners.push(listener)
  }

  /** Runs before a toolbar interaction reveals the tab or resizes the timeline. */
  addActivationListener(id: TopPanelTabId, listener: () => void): void {
    this.tabs[id].activationListeners.push(listener)
  }

  private tabOf(owner: object): TopPanelTab | undefined {
    return Object.values(this.tabs).find((tab) => tab.owner === owner)
  }

  private activateTab(id: TopPanelTabId): void {
    if (!this.isVisible(id)) {
      for (const listener of this.tabs[id].activationListeners) listener()
    }
    this.selectTab(id)
  }

  private selectTab(id: TopPanelTabId): void {
    this.activeTab = id
    for (const tab of Object.values(this.tabs)) {
      const selected = tab.id === id
      tab.button.setAttribute('aria-selected', `${selected}`)
      tab.button.tabIndex = selected ? 0 : -1
      tab.panel.hidden = !selected
    }
    this.updateVisibility()
  }

  private setSize(size: PanelSize): void {
    this.size = size
    if (size !== 'collapsed') this.openSize = size
    this.cancelResize?.()
    this.resizePanel()
  }

  private heights(): Record<PanelSize, number> {
    const viewportHeight = window.innerHeight
    const collapsed = this.footer.offsetHeight + this.root.offsetHeight - this.root.clientHeight
    const full = Math.max(collapsed, viewportHeight - this.applicationHeader.getBoundingClientRect().bottom)
    return { collapsed, half: Math.min(full, Math.max(collapsed, (full - this.footer.offsetHeight) / 2)), full }
  }

  /** The size a drag released at `height` selects: the nearest one, but at least one step in the drag's direction. */
  private snapSize(height: number, expanding: boolean): PanelSize {
    const heights = this.heights()
    let nearest = 0
    for (let i = 1; i < PANEL_SIZES.length; ++i) {
      if (Math.abs(heights[PANEL_SIZES[i]] - height) < Math.abs(heights[PANEL_SIZES[nearest]] - height)) nearest = i
    }
    const current = PANEL_SIZES.indexOf(this.size)
    return PANEL_SIZES[
      expanding
        ? Math.max(nearest, Math.min(current + 1, PANEL_SIZES.length - 1))
        : Math.min(nearest, Math.max(current - 1, 0))
    ]
  }

  private startResize(event: PointerEvent): void {
    const isHandle = event.currentTarget === this.decreaseButton || event.currentTarget === this.increaseButton
    if (
      event.button !== 0 ||
      !event.isPrimary ||
      (isHandle && (event.currentTarget as HTMLButtonElement).disabled) ||
      (!isHandle && event.target instanceof Element && event.target.closest('button'))
    ) {
      return
    }
    this.cancelResize?.()
    event.preventDefault()
    event.stopPropagation()
    const focusButton =
      event.currentTarget === this.increaseButton || this.decreaseButton.disabled
        ? this.increaseButton
        : this.decreaseButton
    focusButton.focus({ preventScroll: true })
    const captureElement = event.currentTarget as HTMLElement
    let handleClick = isHandle
    this.suppressHandleClick = true
    const pointerId = event.pointerId
    const startX = event.clientX
    const startY = event.clientY
    const startHeight = this.root.getBoundingClientRect().height
    const grabOffset = this.root.getBoundingClientRect().bottom - startY
    let currentY = startY
    let releaseSize = this.size
    const requestedHeight = () => currentY - this.applicationHeader.getBoundingClientRect().bottom + grabOffset
    const refreshResize = () => this.resizePanel(requestedHeight())
    captureElement.setPointerCapture(pointerId)
    this.root.classList.add('resizing')
    // Freeze a running snap animation before following the pointer.
    this.resizePanel(startHeight)
    const resize = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return
      currentY = moveEvent.clientY
      const distance = currentY - startY
      if (Math.abs(moveEvent.clientX - startX) >= 4 || Math.abs(distance) >= 4) handleClick = false
      // Keep the drag's intent independent of layout and release coordinates.
      releaseSize = Math.abs(distance) >= SNAP_DISTANCE ? this.snapSize(requestedHeight(), distance > 0) : this.size
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
      if (captureElement.hasPointerCapture(pointerId)) captureElement.releasePointerCapture(pointerId)
      this.resizePanel()
    }
    const finishResize = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== pointerId) return
      if (endEvent.type === 'pointerup') {
        this.suppressHandleClick = !handleClick
        this.size = releaseSize
        if (releaseSize !== 'collapsed') this.openSize = releaseSize
      }
      stopResize()
    }
    this.cancelResize = stopResize
    this.refreshResize = refreshResize
    // Capture loss must not discard the eventual release.
    window.addEventListener('pointermove', resize, true)
    window.addEventListener('pointerup', finishResize, true)
    window.addEventListener('pointercancel', finishResize, true)
    window.addEventListener('blur', stopResize)
  }

  private resizePanel(requestedHeight?: number, immediate = false): void {
    if (this.root.hidden) return
    // Layout changes must not animate through or over the application header.
    if (immediate) this.root.classList.add('layout-resize')
    const heights = this.heights()
    // Intermediate heights are only a drag preview, never retained panel state.
    const height =
      requestedHeight === undefined
        ? heights[this.size]
        : Math.max(heights.collapsed, Math.min(heights.full, requestedHeight))
    this.root.style.height = `${height}px`
    this.setBodyShowing(height > heights.collapsed + 0.5)
    const focusedControl = document.activeElement
    this.decreaseButton.disabled = this.size === 'collapsed'
    this.increaseButton.disabled = this.size === 'full'
    if (this.decreaseButton.disabled && focusedControl === this.decreaseButton) {
      this.increaseButton.focus({ preventScroll: true })
    } else if (this.increaseButton.disabled && focusedControl === this.increaseButton) {
      this.decreaseButton.focus({ preventScroll: true })
    }
    if (immediate) {
      this.root.getBoundingClientRect()
      this.root.classList.remove('layout-resize')
    }
  }

  private setBodyShowing(showing: boolean): void {
    if (showing === this.bodyShowing) return
    // Focus must not stay inside content that is about to become inert.
    if (!showing && this.body.contains(document.activeElement)) {
      this.tabs[this.activeTab].button.focus({ preventScroll: true })
    }
    this.bodyShowing = showing
    this.body.inert = !showing
    this.root.classList.toggle('collapsed', !showing)
    this.updateVisibility()
  }

  private updateVisibility(): void {
    for (const tab of Object.values(this.tabs)) {
      const visible = !this.root.hidden && this.bodyShowing && tab.id === this.activeTab
      if (visible === tab.visible) continue
      tab.visible = visible
      for (const listener of tab.visibilityListeners) listener(visible)
    }
  }
}
