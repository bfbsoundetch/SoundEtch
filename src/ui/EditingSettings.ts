/** What a timeline cut does to tracks outside the selection. */
export type OtherTracksOnCut = 'stay' | 'cut' | 'shift'

export const OTHER_TRACKS_ON_CUT: readonly OtherTracksOnCut[] = ['stay', 'cut', 'shift']

export interface EditingSettings {
  /** Whether a timeline cut pulls the rest of each cut track back to close the gap. */
  readonly rippleCut: boolean
  /**
   * Tracks outside the selection stay as they are, are cut the same way, or, when the cut closes its
   * gap, only have their later audio pulled back with it.
   */
  readonly otherTracks: OtherTracksOnCut
}

export const EDITING_SETTINGS_STORAGE_KEY = 'soundetch.editing-settings'

export const DEFAULT_EDITING_SETTINGS: EditingSettings = Object.freeze({ rippleCut: false, otherTracks: 'stay' })

/** Valid settings from anything stored; shifting other tracks needs a cut that closes its gap. */
export function normalizeEditingSettings(value: unknown): EditingSettings {
  const candidate = value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const rippleCut = candidate.rippleCut === true
  const otherTracks = OTHER_TRACKS_ON_CUT.find((option) => option === candidate.otherTracks) ?? 'stay'
  return Object.freeze({ rippleCut, otherTracks: otherTracks === 'shift' && !rippleCut ? 'stay' : otherTracks })
}

function loadStoredSettings(): EditingSettings {
  try {
    const stored = window.localStorage.getItem(EDITING_SETTINGS_STORAGE_KEY)
    return stored === null ? DEFAULT_EDITING_SETTINGS : normalizeEditingSettings(JSON.parse(stored))
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
    this.settings = normalizeEditingSettings(settings)
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
