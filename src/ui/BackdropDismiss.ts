/**
 * Closes a modal dialog when a pointer press both starts and ends on the dialog element itself: its `::backdrop`, or
 * the blank area around the content of a full-viewport `.overlay` dialog. A click alone cannot tell this apart from a
 * drag that starts in the content (such as selecting text in a field) and ends outside it, since the browser targets
 * that click at the nearest common ancestor of press and release, which is the dialog.
 */
export function closeOnBackdropClick(dialog: HTMLDialogElement) {
  let pressedOnBackdrop = false
  let releasedOnBackdrop = false
  dialog.addEventListener('pointerdown', (event) => {
    pressedOnBackdrop = event.target === dialog
  })
  dialog.addEventListener('pointerup', (event) => {
    releasedOnBackdrop = event.target === dialog
  })
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog && pressedOnBackdrop && releasedOnBackdrop) dialog.close()
  })
}
