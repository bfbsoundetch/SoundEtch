/**
 * Places a closed `.popover-menu` below its trigger with right edges aligned, or above it when the viewport has no
 * room below. Call from `beforetoggle` so the menu opens in place.
 */
export function positionPopoverMenu(popover: HTMLElement, trigger: HTMLElement) {
  // Closed popovers have no layout; measure invisibly before the browser reveals the menu.
  popover.classList.add('popover-menu-positioning')
  const triggerBounds = trigger.getBoundingClientRect()
  const gap = 4
  const viewportPadding = 8
  const left = Math.max(
    viewportPadding,
    Math.min(triggerBounds.right - popover.offsetWidth, window.innerWidth - popover.offsetWidth - viewportPadding),
  )
  let top = triggerBounds.bottom + gap
  if (top + popover.offsetHeight > window.innerHeight - viewportPadding) {
    top = Math.max(viewportPadding, triggerBounds.top - popover.offsetHeight - gap)
  }
  popover.style.left = `${left}px`
  popover.style.top = `${top}px`
  popover.classList.remove('popover-menu-positioning')
}
