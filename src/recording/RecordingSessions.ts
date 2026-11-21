import type { Clip } from '../project/Clip'

export interface RecordingSession {
  readonly dirname: string
  /** AudioInput.id → its clip; video-only clips are absent. */
  readonly clipsByInputId: ReadonlyMap<string, Clip>
  /** Settles when the recording's files are written; never rejects. */
  readonly finished: Promise<void>
  openPatchPort(): MessagePort
}

const listeners = new Set<(session: RecordingSession) => void>()

/** Announces recordings to the high-quality media code without making the initial chunk import the Recorder. */
export class RecordingSessions {
  static addListener(listener: (session: RecordingSession) => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  static publish(session: RecordingSession): void {
    listeners.forEach((listener) => listener(session))
  }
}
