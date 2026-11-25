import { MODEL_CACHE_INFO, getModelCacheUsage, unloadModelCache, type ModelCacheId } from '../ModelCache'
import { humanizeBytes } from './DiskUsage'
import {
  DEFAULT_EDITING_SETTINGS,
  editingSettings,
  normalizeEditingSettings,
  type EditingSettings,
} from './EditingSettings'
import { NotificationsController } from './NotificationsController'

import {
  DEFAULT_SPECTROGRAM_SETTINGS,
  normalizeSpectrogramSettings,
  spectrogramSettings,
  type SpectrogramSettings,
} from './timeline/spectrogram/SpectrogramSettings'

interface ModelCacheControl {
  readonly status: HTMLParagraphElement
  readonly unloadButton: HTMLButtonElement
}

export class SettingsController {
  private readonly menuButton = document.getElementById('open-settings-modal-button') as HTMLButtonElement
  private readonly menuDropdown = document.getElementById('menu-dropdown') as HTMLDivElement
  private readonly dialog = document.getElementById('settings-modal') as HTMLDialogElement
  private readonly form = document.getElementById('settings-form') as HTMLFormElement
  private readonly fftSizeSelect = document.getElementById('spectrogram-fft-size') as HTMLSelectElement
  private readonly hopSizeSelect = document.getElementById('spectrogram-hop-size') as HTMLSelectElement
  private readonly frequencyBandsSelect = document.getElementById('spectrogram-frequency-bands') as HTMLSelectElement
  private readonly windowFunctionSelect = document.getElementById('spectrogram-window-function') as HTMLSelectElement
  private readonly colormapSelect = document.getElementById('spectrogram-colormap') as HTMLSelectElement
  private readonly minDbInput = document.getElementById('spectrogram-min-db') as HTMLInputElement
  private readonly minDbOutput = document.getElementById('spectrogram-min-db-value') as HTMLOutputElement
  private readonly cutModeSelect = document.getElementById('editing-cut-mode') as HTMLSelectElement
  private readonly otherTracksSelect = document.getElementById('editing-other-tracks') as HTMLSelectElement
  private readonly resetButton = document.getElementById('settings-reset-button') as HTMLButtonElement
  private readonly firstSectionSummary = this.dialog.querySelector('.settings-section-summary') as HTMLElement
  private readonly cloudBackupSection = document.getElementById('cloud-backup-settings') as HTMLDetailsElement
  private readonly cloudBackupSettingsButton = document.getElementById('cloud-settings-button') as HTMLButtonElement
  private readonly modelCacheControls = Object.fromEntries(
    MODEL_CACHE_INFO.map(({ id }) => {
      const row = this.dialog.querySelector(`[data-model-cache-id="${id}"]`) as HTMLLIElement
      return [
        id,
        {
          status: row.querySelector('.model-cache-status') as HTMLParagraphElement,
          unloadButton: row.querySelector('.model-cache-unload-button') as HTMLButtonElement,
        },
      ] as const
    }),
  ) as Record<ModelCacheId, ModelCacheControl>
  private modelCacheRefreshVersion = 0

  constructor() {
    this.menuButton.addEventListener('click', () => this.open())
    // Import / Export's Cloud Backup Settings button.
    this.cloudBackupSettingsButton.addEventListener('click', () => {
      this.cloudBackupSettingsButton.closest('dialog')?.close()
      this.open(this.cloudBackupSection)
    })
    // The section's controls stay unwired until it first opens, keeping cloud backup out of the initial chunk.
    this.cloudBackupSection.addEventListener('toggle', () => {
      if (this.cloudBackupSection.open) {
        void import('./CloudBackupController').then(({ CloudBackupController }) => CloudBackupController.start())
      }
    })
    this.form.addEventListener('submit', (event) => {
      event.preventDefault()
      this.apply()
    })
    this.fftSizeSelect.addEventListener('change', () => this.updateDependentOptions())
    this.cutModeSelect.addEventListener('change', () => this.updateOtherTracksOptions())
    this.minDbInput.addEventListener('input', () => this.updateMinDbOutput())
    this.resetButton.addEventListener('click', () => {
      spectrogramSettings.reset()
      editingSettings.reset()
      this.setFormValues(DEFAULT_SPECTROGRAM_SETTINGS, DEFAULT_EDITING_SETTINGS)
      this.dialog.close()
    })
    for (const { id, label } of MODEL_CACHE_INFO) {
      const control = this.modelCacheControls[id]
      control.unloadButton.setAttribute('aria-label', `Unload ${label} cached files`)
      control.unloadButton.addEventListener('click', () => void this.unloadModel(id, label))
    }
  }

  /** Opens the dialog, with `section` expanded and scrolled to when given. */
  private open(section?: HTMLDetailsElement): void {
    this.setFormValues(spectrogramSettings.current, editingSettings.current)
    if (this.menuDropdown.matches(':popover-open')) this.menuDropdown.hidePopover()
    this.dialog.showModal()
    if (section) {
      section.open = true
      section.querySelector('summary')!.focus({ preventScroll: true })
      section.scrollIntoView({ block: 'start' })
    } else {
      this.firstSectionSummary.focus()
    }
    void this.refreshModelCacheUsage()
  }

  private apply(): void {
    const settings = normalizeSpectrogramSettings({
      fftSize: Number(this.fftSizeSelect.value),
      hopSize: Number(this.hopSizeSelect.value),
      frequencyBands: Number(this.frequencyBandsSelect.value),
      windowFunction: this.windowFunctionSelect.value,
      colormap: this.colormapSelect.value,
      minDb: Number(this.minDbInput.value),
    })
    spectrogramSettings.set(settings)
    editingSettings.set(
      normalizeEditingSettings({
        rippleCut: this.cutModeSelect.value === 'ripple',
        otherTracks: this.otherTracksSelect.value,
      }),
    )
    this.setFormValues(settings, editingSettings.current)
    this.dialog.close()
  }

  private setFormValues(settings: SpectrogramSettings, editing: EditingSettings): void {
    this.cutModeSelect.value = editing.rippleCut ? 'ripple' : 'leave'
    this.otherTracksSelect.value = editing.otherTracks
    this.updateOtherTracksOptions()
    this.fftSizeSelect.value = String(settings.fftSize)
    this.hopSizeSelect.value = String(settings.hopSize)
    this.frequencyBandsSelect.value = String(settings.frequencyBands)
    this.windowFunctionSelect.value = settings.windowFunction
    this.colormapSelect.value = settings.colormap
    this.minDbInput.value = String(settings.minDb)
    this.updateMinDbOutput()
    this.updateDependentOptions()
  }

  private updateMinDbOutput(): void {
    const value = `${this.minDbInput.value} dB`
    this.minDbOutput.value = value
    this.minDbInput.setAttribute('aria-valuetext', value)
  }

  /** Other tracks can only shift with a cut that closes its gap. */
  private updateOtherTracksOptions(): void {
    const shift = this.otherTracksSelect.querySelector('option[value="shift"]') as HTMLOptionElement
    shift.disabled = this.cutModeSelect.value !== 'ripple'
    if (shift.disabled && this.otherTracksSelect.value === 'shift') this.otherTracksSelect.value = 'stay'
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

  private async refreshModelCacheUsage(): Promise<void> {
    const refreshVersion = ++this.modelCacheRefreshVersion
    for (const control of Object.values(this.modelCacheControls)) {
      control.status.textContent = 'Checking…'
      control.unloadButton.disabled = true
    }

    try {
      const usage = await getModelCacheUsage()
      if (refreshVersion != this.modelCacheRefreshVersion) return
      for (const { id } of MODEL_CACHE_INFO) {
        const control = this.modelCacheControls[id]
        const bytes = usage[id]
        control.status.textContent = bytes > 0 ? `${humanizeBytes(bytes)} on disk` : 'Not cached'
        control.unloadButton.disabled = bytes == 0
      }
    } catch (error) {
      if (refreshVersion != this.modelCacheRefreshVersion) return
      console.error('Could not read model cache storage', error)
      for (const control of Object.values(this.modelCacheControls)) {
        control.status.textContent = 'Cache storage unavailable'
        control.unloadButton.disabled = true
      }
    }
  }

  private async unloadModel(modelId: ModelCacheId, label: string): Promise<void> {
    ++this.modelCacheRefreshVersion
    const control = this.modelCacheControls[modelId]
    control.status.textContent = 'Unloading…'
    control.unloadButton.disabled = true
    try {
      await unloadModelCache(modelId)
      NotificationsController.showShortDurationMessage(`Unloaded ${label} cached files.`)
    } catch (error) {
      NotificationsController.showError(error instanceof Error ? error : new Error(String(error)))
    } finally {
      await this.refreshModelCacheUsage()
    }
  }
}
