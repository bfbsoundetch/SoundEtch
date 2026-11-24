import { createSvgIcon } from './SvgIcon'
import type { TranscriptTextEdit } from './transcript/TranscriptTextEdit'

export class TranscriptEditDialogController {
  private static nextId = 0

  private readonly dialog = document.createElement('dialog')
  private readonly form = document.createElement('form')
  private readonly fieldsContainer = document.createElement('div')
  private readonly guidance = document.createElement('p')
  private readonly errorElement = document.createElement('p')
  private readonly closeButton = document.createElement('button')
  private readonly cancelButton = document.createElement('button')
  private readonly submitButton = document.createElement('button')
  private readonly fields: HTMLTextAreaElement[] = []
  private readonly id = `transcript-edit-${TranscriptEditDialogController.nextId++}`
  private onSubmit: ((texts: readonly string[]) => Promise<void>) | null = null
  private onClose: (() => void) | null = null
  private returnFocus: HTMLElement | null = null
  private submitting = false
  private requestId = 0

  constructor() {
    this.dialog.className = 'overlay'
    this.dialog.setAttribute('aria-labelledby', `${this.id}-title`)
    this.dialog.setAttribute('aria-describedby', `${this.id}-guidance`)

    const heading = document.createElement('h1')
    heading.id = `${this.id}-title`
    heading.textContent = 'Edit transcript text'
    this.guidance.id = `${this.id}-guidance`
    this.fieldsContainer.className = 'transcript-edit-fields'

    this.errorElement.className = 'transcript-edit-error'
    this.errorElement.setAttribute('role', 'alert')
    this.errorElement.hidden = true

    this.closeButton.type = 'button'
    this.closeButton.className = 'overlay-close-button clickable'
    this.closeButton.setAttribute('aria-label', 'Close')
    this.closeButton.title = 'Close'
    this.closeButton.append(createSvgIcon('menu-close', { className: 'meeting-icon' }))
    this.closeButton.addEventListener('click', () => {
      if (!this.submitting) this.dismiss()
    })

    this.cancelButton.type = 'button'
    this.cancelButton.className = 'bordered clickable'
    this.cancelButton.textContent = 'Cancel'
    this.cancelButton.addEventListener('click', () => {
      if (!this.submitting) this.dismiss()
    })

    this.submitButton.type = 'submit'
    this.submitButton.className = 'bordered clickable'
    this.submitButton.textContent = 'Apply'

    const actions = document.createElement('div')
    actions.className = 'transcript-edit-actions'
    actions.append(this.cancelButton, this.submitButton)
    this.form.className = 'overlay-content transcript-edit-content'
    this.form.append(heading, this.guidance, this.fieldsContainer, this.errorElement, actions)
    this.form.addEventListener('submit', (event) => {
      event.preventDefault()
      void this.submit()
    })
    this.dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault()
        event.stopPropagation()
        if (!this.submitting) this.form.requestSubmit()
      }
    })
    this.dialog.addEventListener('cancel', (event) => {
      event.preventDefault()
      if (!this.submitting) this.dismiss()
    })
    this.dialog.addEventListener('close', () => {
      // A close event can arrive after the same dialog has already reopened.
      if (!this.dialog.open) this.finishClose()
    })
    this.dialog.append(this.closeButton, this.form)
    document.body.appendChild(this.dialog)
  }

  open(
    edits: readonly TranscriptTextEdit[],
    sampleRate: number,
    onSubmit: (texts: readonly string[]) => Promise<void>,
    onClose: () => void,
  ): void {
    this.close()
    const active = document.activeElement
    this.returnFocus = active instanceof HTMLElement && active !== document.body ? active : null
    this.onSubmit = onSubmit
    this.onClose = onClose
    this.guidance.textContent =
      'Each replacement remains one timed chunk per source clip range. Audio and alignment are unchanged. Leave a field blank to remove its text.' +
      (edits.length > 1 ? ' These fields are separate source clip ranges.' : '')
    this.fields.length = 0
    this.fieldsContainer.replaceChildren()
    edits.forEach((edit, index) => {
      const label = document.createElement('label')
      const caption = document.createElement('span')
      const startSeconds = (edit.startSample / sampleRate).toFixed(3)
      const endSeconds = (edit.endSample / sampleRate).toFixed(3)
      caption.textContent = `Range ${index + 1}: ${edit.clip.name} — source ${startSeconds}–${endSeconds} seconds`
      const field = document.createElement('textarea')
      field.id = `${this.id}-text-${index}`
      field.className = 'transcript-edit-text'
      field.rows = 6
      field.spellcheck = true
      field.value = edit.text
      label.htmlFor = field.id
      label.append(caption, field)
      this.fields.push(field)
      this.fieldsContainer.append(label)
    })
    this.errorElement.hidden = true
    this.errorElement.textContent = ''
    this.setSubmitting(false)
    this.dialog.showModal()
    const first = this.fields[0]
    if (first) {
      first.focus()
      first.select()
    }
  }

  close(): void {
    this.onClose = null
    this.dismiss()
  }

  private dismiss(): void {
    if (this.dialog.open) this.dialog.close()
    this.finishClose()
  }

  private finishClose(): void {
    ++this.requestId
    this.onSubmit = null
    const onClose = this.onClose
    this.onClose = null
    const target = this.returnFocus
    this.returnFocus = null
    if (target?.isConnected) target.focus()
    onClose?.()
  }

  private setSubmitting(submitting: boolean): void {
    this.submitting = submitting
    this.form.setAttribute('aria-busy', String(submitting))
    // Escape, Cancel and the close button wait for the edit to settle; so does a click outside the box.
    this.dialog.classList.toggle('no-backdrop-close', submitting)
    this.fields.forEach((field) => {
      field.disabled = submitting
    })
    this.closeButton.disabled = submitting
    this.cancelButton.disabled = submitting
    this.submitButton.disabled = submitting
  }

  private async submit(): Promise<void> {
    if (this.submitting || !this.onSubmit || !this.dialog.open) return
    const onSubmit = this.onSubmit
    const requestId = this.requestId
    const texts = this.fields.map((field) => field.value)
    const active = document.activeElement
    this.errorElement.hidden = true
    this.setSubmitting(true)
    try {
      await onSubmit(texts)
      if (this.requestId === requestId) this.dismiss()
    } catch (error) {
      if (this.requestId !== requestId) return
      const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
      this.errorElement.textContent = message || 'Unable to apply transcript changes. Please try again.'
      this.errorElement.hidden = false
      this.setSubmitting(false)
      if (active instanceof HTMLElement && active.isConnected && this.dialog.contains(active)) active.focus()
    }
  }
}
