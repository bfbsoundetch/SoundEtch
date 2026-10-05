/**
 * Small dialog that asks for a timeline position through number fields for
 * hours, minutes, seconds and milliseconds, and reports the entered time in
 * milliseconds to the given listener.
 */
export class GoToTimeController {
  private static readonly FIELD_WEIGHTS_MS = [3_600_000, 60_000, 1_000, 1]
  private static readonly FIELD_LABELS = ['Hours', 'Minutes', 'Seconds', 'Milliseconds']
  private static readonly FIELD_CAPTIONS = ['HH', 'MM', 'SS', 'sss']

  private readonly dialog = document.createElement('dialog')
  private readonly fields = new Array<HTMLInputElement>()

  constructor(private readonly onGoTo: (ms: number) => void) {
    this.dialog.className = 'go-to-time-dialog'

    const heading = document.createElement('h1')
    heading.textContent = 'Go to time'

    const fieldsRow = document.createElement('div')
    fieldsRow.className = 'go-to-time-fields'
    const digitCounts = [2, 2, 2, 3]
    const separators = [':', ':', '.', '']
    for (let i = 0; i < digitCounts.length; ++i) {
      const caption = document.createElement('span')
      caption.className = 'go-to-time-caption'
      caption.textContent = GoToTimeController.FIELD_CAPTIONS[i]
      caption.style.gridArea = `1 / ${i * 2 + 1}`
      fieldsRow.appendChild(caption)

      const field = this.createField(i, digitCounts[i])
      field.style.gridArea = `2 / ${i * 2 + 1}`
      this.fields.push(field)
      fieldsRow.appendChild(field)

      if (separators[i]) {
        const separator = document.createElement('span')
        separator.className = 'go-to-time-separator'
        separator.textContent = separators[i]
        separator.style.gridArea = `2 / ${i * 2 + 2}`
        fieldsRow.appendChild(separator)
      }
    }

    const cancelButton = document.createElement('button')
    cancelButton.type = 'button'
    cancelButton.className = 'bordered clickable'
    cancelButton.textContent = 'Cancel'
    cancelButton.addEventListener('click', () => this.dialog.close())

    const goToButton = document.createElement('button')
    goToButton.type = 'button'
    goToButton.className = 'bordered clickable'
    goToButton.textContent = 'Go'
    goToButton.addEventListener('click', () => this.submit())

    const buttonRow = document.createElement('div')
    buttonRow.className = 'go-to-time-buttons'
    buttonRow.append(cancelButton, goToButton)

    this.dialog.append(heading, fieldsRow, buttonRow)
    this.dialog.addEventListener('click', (event) => {
      if (event.target == this.dialog) {
        this.dialog.close()
      }
    })
    document.body.appendChild(this.dialog)
  }

  open() {
    this.fields.forEach((field) => {
      field.value = '0'
      field.classList.remove('go-to-time-invalid')
    })
    this.dialog.showModal()
    this.fields[0].focus()
    this.fields[0].select()
  }

  remove() {
    this.dialog.remove()
  }

  private createField(fieldIndex: number, digitCount: number): HTMLInputElement {
    const field = document.createElement('input')
    field.className = 'go-to-time-input'
    field.type = 'number'
    field.min = '0'
    field.step = '1'
    field.value = '0'
    field.style.width = `${digitCount + 2}ch`
    field.setAttribute('aria-label', GoToTimeController.FIELD_LABELS[fieldIndex])
    field.addEventListener('focus', () => field.select())
    field.addEventListener('input', () => {
      const next = this.fields[fieldIndex + 1]
      if (field.value.length >= digitCount && next) {
        next.focus()
      }
    })
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
      field.classList.toggle('go-to-time-invalid', invalid)
      if (invalid) {
        allValid = false
        return
      }
      ms += value * GoToTimeController.FIELD_WEIGHTS_MS[index]
    })
    if (!allValid) {
      const firstInvalid = this.fields.find((field) => field.classList.contains('go-to-time-invalid'))
      firstInvalid?.focus()
      firstInvalid?.select()
      return
    }
    this.dialog.close()
    this.onGoTo(ms)
  }
}
