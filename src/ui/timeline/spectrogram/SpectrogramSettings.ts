import { WindowFunction } from '../../../analyzers/FFTWindowFunctions'
import {
  BASE_HOP,
  FFT_SIZE,
  FREQUENCY_BANDS,
  MIN_DB,
  SPECTROGRAM_COLORMAPS,
  SPECTROGRAM_WINDOW_FUNCTIONS,
  type SpectrogramColormap,
  type SpectrogramWindowFunction,
} from './SpectrogramTiling'

export interface SpectrogramSettings {
  readonly fftSize: number
  readonly hopSize: number
  readonly frequencyBands: number
  readonly windowFunction: SpectrogramWindowFunction
  readonly minDb: number
  readonly colormap: SpectrogramColormap
}
export const SPECTROGRAM_FFT_SIZES = [512, 1024, 2048, 4096] as const
export const SPECTROGRAM_HOP_SIZES = [128, 256, 512, 1024] as const
export const SPECTROGRAM_FREQUENCY_BANDS = [128, 256, 512] as const
export const SPECTROGRAM_MIN_DB_RANGE = { minimum: -160, maximum: -1 } as const
export const SPECTROGRAM_SETTINGS_STORAGE_KEY = 'soundetch.spectrogram-settings'

export const DEFAULT_SPECTROGRAM_SETTINGS: SpectrogramSettings = Object.freeze({
  fftSize: FFT_SIZE,
  hopSize: BASE_HOP,
  frequencyBands: FREQUENCY_BANDS,
  windowFunction: WindowFunction.BLACKMAN,
  minDb: MIN_DB,
  colormap: 'viridis',
})

function supportedValue(value: unknown, supportedValues: readonly number[], fallback: number): number {
  return typeof value === 'number' && supportedValues.includes(value) ? value : fallback
}

export function normalizeSpectrogramSettings(value: unknown): SpectrogramSettings {
  const candidate = value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
  const fftSize = supportedValue(candidate.fftSize, SPECTROGRAM_FFT_SIZES, DEFAULT_SPECTROGRAM_SETTINGS.fftSize)
  const requestedHopSize = supportedValue(
    candidate.hopSize,
    SPECTROGRAM_HOP_SIZES,
    DEFAULT_SPECTROGRAM_SETTINGS.hopSize,
  )
  const hopSize = requestedHopSize <= fftSize
    ? requestedHopSize
    : Math.max(...SPECTROGRAM_HOP_SIZES.filter((size) => size <= fftSize))
  const requestedFrequencyBands = supportedValue(
    candidate.frequencyBands,
    SPECTROGRAM_FREQUENCY_BANDS,
    DEFAULT_SPECTROGRAM_SETTINGS.frequencyBands,
  )
  const frequencyBands = requestedFrequencyBands <= fftSize / 2
    ? requestedFrequencyBands
    : Math.max(...SPECTROGRAM_FREQUENCY_BANDS.filter((count) => count <= fftSize / 2))
  const windowFunction = SPECTROGRAM_WINDOW_FUNCTIONS.find(
    (supportedWindowFunction) => supportedWindowFunction === candidate.windowFunction,
  ) ?? DEFAULT_SPECTROGRAM_SETTINGS.windowFunction
  const colormap = SPECTROGRAM_COLORMAPS.find((supported) => supported === candidate.colormap)
    ?? DEFAULT_SPECTROGRAM_SETTINGS.colormap
  const requestedMinDb = typeof candidate.minDb === 'number' && Number.isFinite(candidate.minDb)
    ? Math.round(candidate.minDb)
    : DEFAULT_SPECTROGRAM_SETTINGS.minDb
  const minDb = Math.max(
    SPECTROGRAM_MIN_DB_RANGE.minimum,
    Math.min(SPECTROGRAM_MIN_DB_RANGE.maximum, requestedMinDb),
  )

  return Object.freeze({ fftSize, hopSize, frequencyBands, windowFunction, colormap, minDb })
}

function loadStoredSettings(): SpectrogramSettings {
  try {
    if (typeof window === 'undefined') return DEFAULT_SPECTROGRAM_SETTINGS
    const storedValue = window.localStorage.getItem(SPECTROGRAM_SETTINGS_STORAGE_KEY)
    return storedValue === null ? DEFAULT_SPECTROGRAM_SETTINGS : normalizeSpectrogramSettings(JSON.parse(storedValue))
  } catch {
    return DEFAULT_SPECTROGRAM_SETTINGS
  }
}

function settingsEqual(left: SpectrogramSettings, right: SpectrogramSettings): boolean {
  return (
    left.fftSize === right.fftSize &&
    left.hopSize === right.hopSize &&
    left.frequencyBands === right.frequencyBands &&
    left.windowFunction === right.windowFunction &&
    left.colormap === right.colormap &&
    left.minDb === right.minDb
  )
}

class SpectrogramSettingsStore {
  private settings = loadStoredSettings()
  private readonly listeners = new Set<(settings: SpectrogramSettings) => void>()

  get current(): SpectrogramSettings {
    return this.settings
  }

  set(settings: SpectrogramSettings): void {
    const normalized = normalizeSpectrogramSettings(settings)
    if (settingsEqual(normalized, this.settings)) return

    this.settings = normalized
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(SPECTROGRAM_SETTINGS_STORAGE_KEY, JSON.stringify(normalized))
      }
    } catch {
      // The in-memory setting remains usable when browser storage is unavailable.
    }
    for (const listener of this.listeners) listener(normalized)
  }

  reset(): void {
    const changed = !settingsEqual(this.settings, DEFAULT_SPECTROGRAM_SETTINGS)
    this.settings = DEFAULT_SPECTROGRAM_SETTINGS
    try {
      if (typeof window !== 'undefined') window.localStorage.removeItem(SPECTROGRAM_SETTINGS_STORAGE_KEY)
    } catch {
      // The in-memory setting still resets when browser storage is unavailable.
    }
    if (changed) {
      for (const listener of this.listeners) listener(DEFAULT_SPECTROGRAM_SETTINGS)
    }
  }

  addChangeListener(listener: (settings: SpectrogramSettings) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

export const spectrogramSettings = new SpectrogramSettingsStore()
