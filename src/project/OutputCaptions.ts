import type { Track } from './Track'

/** Project-wide text over the composed 16:9 video, independent of scene transitions. */
export interface OutputCaptionSettings {
  enabled: boolean
  /** Fixed source; null uses the first audible transcript unless followLoudest is enabled. */
  track: Track | null
  /** Follow the loudest audible track with words at the current timeline position. */
  followLoudest?: boolean
  fontFamily: string
  /** Pixels on the 1920×1080 composition. */
  fontSize: number
  /** Missing values keep the original bottom placement. */
  position?: 'bottom' | 'middle' | 'top'
  color: string
  highlightColor: string
  /** Missing values use the default dark text shadow. */
  shadowEnabled?: boolean
  shadowColor?: string
}

export const OUTPUT_CAPTION_FONTS = [
  { label: 'Sans serif', value: 'Arial, sans-serif' },
  { label: 'Serif', value: 'Georgia, serif' },
  { label: 'Monospace', value: 'monospace' },
  { label: 'Verdana', value: 'Verdana, sans-serif' },
] as const

export const DEFAULT_OUTPUT_CAPTIONS: Readonly<OutputCaptionSettings> = Object.freeze({
  enabled: false,
  track: null,
  followLoudest: true,
  fontFamily: OUTPUT_CAPTION_FONTS[0].value,
  fontSize: 64,
  position: 'bottom',
  color: '#ffffff',
  highlightColor: '#ffd54f',
  shadowEnabled: true,
  shadowColor: '#000000',
})

export interface OutputCaptionWord {
  readonly text: string
  readonly startSample: number
  readonly endSample: number
}

export interface OutputCaptionCue {
  readonly startSample: number
  readonly endSample: number
  readonly words: readonly OutputCaptionWord[]
}
