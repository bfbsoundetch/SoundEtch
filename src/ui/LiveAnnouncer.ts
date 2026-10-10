export type Politeness = 'polite' | 'assertive'
type Regions = Record<Politeness, HTMLDivElement>
const regionsByHost = new WeakMap<HTMLElement, Regions>()

/** Announces a status message to assistive technology without moving focus. */
export function announce(message: string, politeness: Politeness = 'polite'): void {
  const host = currentHost()
  let regions = regionsByHost.get(host)
  if (!regions) {
    regions = { polite: createRegion('polite'), assertive: createRegion('assertive') }
    host.append(regions.polite, regions.assertive)
    regionsByHost.set(host, regions)
  }
  const region = regions[politeness]
  region.textContent = ''
  window.setTimeout(() => {
    region.textContent = message
  }, 100)
}

// Everything outside an open modal <dialog> is inert, so a region in <body> is silent while a modal is open.
function currentHost(): HTMLElement {
  const focusedModal = document.activeElement?.closest<HTMLDialogElement>('dialog:modal')
  if (focusedModal) return focusedModal
  const modals = document.querySelectorAll<HTMLDialogElement>('dialog:modal')
  return modals.length > 0 ? modals[modals.length - 1] : document.body
}

function createRegion(politeness: Politeness): HTMLDivElement {
  const region = document.createElement('div')
  region.className = 'visually-hidden'
  region.setAttribute('role', politeness === 'assertive' ? 'alert' : 'status')
  region.setAttribute('aria-live', politeness)
  region.setAttribute('aria-atomic', 'true')
  return region
}
