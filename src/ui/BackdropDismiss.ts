/**
 * Closes a `dialog.overlay` without `.no-backdrop-close` when a pointer press both starts and ends on the dialog element
 * itself: the blank area around its `.overlay-content`. A click alone cannot tell this apart from a drag that starts in
 * the content (such as selecting text in a field) and ends outside it, since the browser targets that click at the
 * nearest common ancestor of press and release, which is the dialog.
 */
export function installBackdropDismissal() {
  let pressed: EventTarget | null = null
  let released: EventTarget | null = null
  // Capturing, so that no handler stopping propagation leaves a stale target behind.
  document.addEventListener(
    'pointerdown',
    (event) => {
      pressed = event.target
    },
    true,
  )
  document.addEventListener(
    'pointerup',
    (event) => {
      released = event.target
    },
    true,
  )
  document.addEventListener(
    'click',
    (event) => {
      const dialog = event.target
      if (
        dialog instanceof HTMLDialogElement &&
        dialog.matches('.overlay:not(.no-backdrop-close)') &&
        pressed === dialog &&
        released === dialog
      ) {
        dialog.close()
      }
    },
    true,
  )
}
