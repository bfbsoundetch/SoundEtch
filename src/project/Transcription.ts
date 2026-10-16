/** Audio without a recognized word: quiet audio, or sound the VAD supports but Granite did not transcribe. */
export type TranscriptGapKind = 'silence' | 'untranscribed'

export interface TranscribedRange {
  /** Recognized words; empty for gaps. */
  readonly text: string
  readonly startSample: number
  readonly endSample: number
  /** Unpadded VAD-region onset in clip source samples, shared by its words. */
  readonly speechStartSample?: number
  /** Absent on recognized words. */
  readonly kind?: TranscriptGapKind
}
