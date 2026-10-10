export type TimeEntryRequest = { title: string; submitLabel: string; initialMs: number; onSubmit: (ms: number) => void }

/**
 * Small dialog that asks for a timeline position through number fields for
 * hours, minutes, seconds and milliseconds, and reports the entered time in
 * milliseconds to the request's submit handler.
 */
export class TimeEntryDialogController {
  private static readonly FIELD_WEIGHTS_MS = [3_600_000, 60_000, 1_000, 1]
  private static readonly FIELD_LABELS = ['Hours', 'Minutes', 'Seconds', 'Milliseconds']
  private static readonly FIELD_CAPTIONS = ['HH', 'MM', 'SS', 'sss']

  private readonly dialog = document.createElement('dialog')
  private readonly fields = new Array<HTMLInputElement>()
  private readonly heading = document.createElement('h1')
  private readonly submitButton = document.createElement('button')
  private readonly errorElement = document.createElement('p')
  private request: TimeEntryRequest | null = null
  private returnFocus: HTMLElement | null = null

  constructor() {
    this.dialog.className = 'go-to-time-dialog'
    this.dialog.setAttribute('aria-labelledby', 'time-entry-dialog-title')

    this.heading.id = 'time-entry-dialog-title'

    const fieldsRow = document.createElement('div')
    fieldsRow.className = 'go-to-time-fields'
    const separators = [':', ':', '.', '']
    for (let i = 0; i < TimeEntryDialogController.FIELD_CAPTIONS.length; ++i) {
      const caption = document.createElement('span')
      caption.className = 'go-to-time-caption'
      caption.textContent = TimeEntryDialogController.FIELD_CAPTIONS[i]
      caption.dataset.field = TimeEntryDialogController.FIELD_LABELS[i].toLowerCase()
      fieldsRow.appendChild(caption)

      const field = this.createField(i)
      this.fields.push(field)
      fieldsRow.appendChild(field)

      if (separators[i]) {
        const separator = document.createElement('span')
        separator.className = 'go-to-time-separator'
        separator.textContent = separators[i]
        separator.dataset.field = TimeEntryDialogController.FIELD_LABELS[i].toLowerCase()
        fieldsRow.appendChild(separator)
      }
    }

    const cancelButton = document.createElement('button')
    cancelButton.type = 'button'
    cancelButton.className = 'bordered clickable'
    cancelButton.textContent = 'Cancel'
    cancelButton.addEventListener('click', () => this.dialog.close())

    this.submitButton.type = 'button'
    this.submitButton.className = 'bordered clickable'
    this.submitButton.addEventListener('click', () => this.submit())

    const buttonRow = document.createElement('div')
    buttonRow.className = 'go-to-time-buttons'
    buttonRow.append(cancelButton, this.submitButton)

    this.errorElement.id = 'time-entry-error'
    this.errorElement.className = 'go-to-time-error'
    this.errorElement.setAttribute('role', 'alert')
    this.errorElement.hidden = true
    this.errorElement.textContent = 'Enter numbers 0 or greater.'

    this.dialog.append(this.heading, fieldsRow, this.errorElement, buttonRow)
    this.dialog.addEventListener('close', () => {
      const target = this.returnFocus
      this.returnFocus = null
      if (target?.isConnected) {
        target.focus()
      }
    })
    this.dialog.addEventListener('click', (event) => {
      if (event.target == this.dialog) {
        this.dialog.close()
      }
    })
    document.body.appendChild(this.dialog)
  }

  open(request: TimeEntryRequest) {
    this.request = request
    const active = document.activeElement
    this.returnFocus = active instanceof HTMLElement && active !== document.body ? active : null
    this.heading.textContent = request.title
    this.submitButton.textContent = request.submitLabel
    let remaining = Math.max(0, Math.round(request.initialMs))
    this.fields.forEach((field, index) => {
      const weight = TimeEntryDialogController.FIELD_WEIGHTS_MS[index]
      field.value = String(Math.floor(remaining / weight))
      remaining %= weight
      field.removeAttribute('aria-invalid')
      field.removeAttribute('aria-describedby')
    })
    this.errorElement.hidden = true
    this.dialog.showModal()
    this.fields[1].focus()
    this.fields[1].select()
  }

  remove() {
    this.dialog.remove()
  }

  private createField(fieldIndex: number): HTMLInputElement {
    const field = document.createElement('input')
    field.className = 'go-to-time-input'
    field.type = 'number'
    field.min = '0'
    field.step = '1'
    field.value = '0'
    field.dataset.field = TimeEntryDialogController.FIELD_LABELS[fieldIndex].toLowerCase()
    field.setAttribute(
      'aria-label',
      `${TimeEntryDialogController.FIELD_LABELS[fieldIndex]} (${TimeEntryDialogController.FIELD_CAPTIONS[fieldIndex]})`,
    )
    field.addEventListener('focus', () => field.select())
    field.addEventListener('keydown', (event) => {
      if (event.key == 'Enter') {
        event.preventDefault()
        this.submit()
      }
    })
    return field
  }

  private submit() {
    let ms = 0
    let allValid = true
    this.fields.forEach((field, index) => {
      const value = Number(field.value)
      const invalid = Number.isNaN(value) || value < 0
      if (invalid) {
        field.setAttribute('aria-invalid', 'true')
        field.setAttribute('aria-describedby', 'time-entry-error')
      } else {
        field.removeAttribute('aria-invalid')
        field.removeAttribute('aria-describedby')
      }
      if (invalid) {
        allValid = false
        return
      }
      ms += value * TimeEntryDialogController.FIELD_WEIGHTS_MS[index]
    })
    if (!allValid) {
      this.errorElement.hidden = false
      const firstInvalid = this.fields.find((field) => field.getAttribute('aria-invalid') == 'true')
      firstInvalid?.focus()
      firstInvalid?.select()
      return
    }
    const request = this.request
    this.dialog.close()
    request?.onSubmit(ms)
  }
}
