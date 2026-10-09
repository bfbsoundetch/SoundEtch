export interface TranscribedRange {
  readonly text: string
  readonly startSample: number
  readonly endSample: number
  /** Unpadded VAD-region onset in clip source samples, shared by its words. */
  readonly speechStartSample?: number
}
