import {
  DEFAULT_SPECTROGRAM_SETTINGS,
  normalizeSpectrogramSettings,
  spectrogramSettings,
  type SpectrogramSettings,
} from './timeline/spectrogram/SpectrogramSettings'

export class SettingsController {
  private readonly menuButton = document.getElementById('open-settings-modal-button') as HTMLButtonElement
  private readonly menuDropdown = document.getElementById('menu-dropdown') as HTMLDivElement
  private readonly dialog = document.getElementById('settings-modal') as HTMLDialogElement
  private readonly form = document.getElementById('settings-form') as HTMLFormElement
  private readonly fftSizeSelect = document.getElementById('spectrogram-fft-size') as HTMLSelectElement
  private readonly hopSizeSelect = document.getElementById('spectrogram-hop-size') as HTMLSelectElement
  private readonly frequencyBandsSelect = document.getElementById('spectrogram-frequency-bands') as HTMLSelectElement
  private readonly windowFunctionSelect = document.getElementById(
    'spectrogram-window-function',
  ) as HTMLSelectElement
  private readonly minDbInput = document.getElementById('spectrogram-min-db') as HTMLInputElement
  private readonly minDbOutput = document.getElementById('spectrogram-min-db-value') as HTMLOutputElement
  private readonly resetButton = document.getElementById('settings-reset-button') as HTMLButtonElement

  constructor() {
    this.menuButton.addEventListener('click', () => this.open())
    this.form.addEventListener('submit', (event) => {
      event.preventDefault()
      this.apply()
    })
    this.fftSizeSelect.addEventListener('change', () => this.updateDependentOptions())
    this.minDbInput.addEventListener('input', () => this.updateMinDbOutput())
    this.resetButton.addEventListener('click', () => {
      spectrogramSettings.reset()
      this.setFormValues(DEFAULT_SPECTROGRAM_SETTINGS)
      this.dialog.close()
    })
  }

  private open(): void {
    this.setFormValues(spectrogramSettings.current)
    if (this.menuDropdown.matches(':popover-open')) this.menuDropdown.hidePopover()
    this.dialog.showModal()
    this.fftSizeSelect.focus()
  }

  private apply(): void {
    const settings = normalizeSpectrogramSettings({
      fftSize: Number(this.fftSizeSelect.value),
      hopSize: Number(this.hopSizeSelect.value),
      frequencyBands: Number(this.frequencyBandsSelect.value),
      windowFunction: this.windowFunctionSelect.value,
      minDb: Number(this.minDbInput.value),
    })
    spectrogramSettings.set(settings)
    this.setFormValues(settings)
    this.dialog.close()
  }

  private setFormValues(settings: SpectrogramSettings): void {
    this.fftSizeSelect.value = String(settings.fftSize)
    this.hopSizeSelect.value = String(settings.hopSize)
    this.frequencyBandsSelect.value = String(settings.frequencyBands)
    this.windowFunctionSelect.value = settings.windowFunction
    this.minDbInput.value = String(settings.minDb)
    this.updateMinDbOutput()
    this.updateDependentOptions()
  }

  private updateMinDbOutput(): void {
    const value = `${this.minDbInput.value} dB`
    this.minDbOutput.value = value
    this.minDbInput.setAttribute('aria-valuetext', value)
  }

  private updateDependentOptions(): void {
    const fftSize = Number(this.fftSizeSelect.value)
    this.updateOptions(this.hopSizeSelect, (value) => value <= fftSize)
    this.updateOptions(this.frequencyBandsSelect, (value) => value <= fftSize / 2)
  }

  private updateOptions(select: HTMLSelectElement, isSupported: (value: number) => boolean): void {
    const options = Array.from(select.options)
    for (const option of options) option.disabled = !isSupported(Number(option.value))
    if (isSupported(Number(select.value))) return
    const fallback = options.filter((option) => !option.disabled).at(-1)
    if (fallback !== undefined) select.value = fallback.value
  }
}
