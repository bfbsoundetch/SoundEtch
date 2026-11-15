export interface EditingSettings {
  /** Whether a timeline cut pulls the rest of each selected track back to close the gap. */
  readonly rippleCut: boolean
}

export const EDITING_SETTINGS_STORAGE_KEY = 'soundetch.editing-settings'

export const DEFAULT_EDITING_SETTINGS: EditingSettings = Object.freeze({ rippleCut: false })

function loadStoredSettings(): EditingSettings {
  try {
    const stored = window.localStorage.getItem(EDITING_SETTINGS_STORAGE_KEY)
    return stored === null
      ? DEFAULT_EDITING_SETTINGS
      : Object.freeze({ rippleCut: JSON.parse(stored)?.rippleCut === true })
  } catch {
    return DEFAULT_EDITING_SETTINGS
  }
}

/** Editing preferences, kept in this browser for every project. */
class EditingSettingsStore {
  private settings = loadStoredSettings()

  get current(): EditingSettings {
    return this.settings
  }

  set(settings: EditingSettings): void {
    this.settings = Object.freeze({ rippleCut: settings.rippleCut })
    try {
      window.localStorage.setItem(EDITING_SETTINGS_STORAGE_KEY, JSON.stringify(this.settings))
    } catch {
      // The in-memory setting remains usable when browser storage is unavailable.
    }
  }

  reset(): void {
    this.settings = DEFAULT_EDITING_SETTINGS
    try {
      window.localStorage.removeItem(EDITING_SETTINGS_STORAGE_KEY)
    } catch {
      // The in-memory setting still resets when browser storage is unavailable.
    }
  }
}

export const editingSettings = new EditingSettingsStore()
