import { RecordingModeSetting, type RecordingMode } from '../recording/RecordingMode'
import { positionPopoverMenu } from './PopoverMenu'

const MODE_DESCRIPTIONS: Record<RecordingMode, string> = {
  'audio-video': 'audio and video',
  'audio-only': 'audio only',
}

/** The caret on the record button, choosing whether recordings capture video along with audio. */
export class RecordingModeMenuController {
  private readonly button = document.getElementById('recording-mode-button') as HTMLButtonElement
  private readonly menu = document.getElementById('recording-mode-menu') as HTMLDivElement
  private readonly options = Array.from(this.menu.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'))

  constructor() {
    for (const option of this.options) {
      option.addEventListener('click', () => {
        RecordingModeSetting.set(option.dataset.recordingMode as RecordingMode)
        this.close()
      })
    }
    this.menu.addEventListener('beforetoggle', (event) => {
      if (event.newState == 'open') positionPopoverMenu(this.menu, this.button)
    })
    this.menu.addEventListener('toggle', () => {
      const isOpen = this.menu.matches(':popover-open')
      this.button.setAttribute('aria-expanded', String(isOpen))
      if (isOpen && !this.menu.contains(document.activeElement)) this.checkedOption().focus()
    })
    this.menu.addEventListener('focusout', (event) => {
      const next = event.relatedTarget as Node | null
      if (next && (this.menu.contains(next) || next === this.button)) return
      this.menu.hidePopover()
    })
    this.menu.addEventListener('keydown', (event) => {
      const focusedIndex = this.options.indexOf(document.activeElement as HTMLButtonElement)
      let nextIndex: number | null = null
      if (event.key == 'ArrowDown') nextIndex = (focusedIndex + 1) % this.options.length
      if (event.key == 'ArrowUp') nextIndex = (focusedIndex - 1 + this.options.length) % this.options.length
      if (event.key == 'Home') nextIndex = 0
      if (event.key == 'End') nextIndex = this.options.length - 1
      if (event.key == 'Escape') {
        event.preventDefault()
        this.close()
        return
      }
      if (nextIndex === null) return
      event.preventDefault()
      this.options[nextIndex].focus()
    })
    this.button.addEventListener('keydown', (event) => {
      if (event.key != 'ArrowDown' && event.key != 'ArrowUp') return
      event.preventDefault()
      if (!this.menu.matches(':popover-open')) this.menu.showPopover()
      ;(event.key == 'ArrowUp' ? this.options[this.options.length - 1] : this.options[0]).focus()
    })
    RecordingModeSetting.addListener(() => this.render())
    this.render()
  }

  /** The mode applies when a recording starts, so it is offered only while stopped. */
  setAvailable(available: boolean) {
    this.button.hidden = !available
    if (!available) this.menu.hidePopover()
  }

  private close() {
    this.menu.hidePopover()
    this.button.focus()
  }

  private checkedOption() {
    return this.options.find((option) => option.dataset.recordingMode == RecordingModeSetting.get())!
  }

  private render() {
    const mode = RecordingModeSetting.get()
    for (const option of this.options) {
      option.setAttribute('aria-checked', String(option.dataset.recordingMode == mode))
    }
    this.button.getElementsByTagName('span')[0].innerText = `Recording mode: ${MODE_DESCRIPTIONS[mode]}`
  }
}
