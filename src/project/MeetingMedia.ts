import type { CloudProviderId } from '../backup/CloudStorage'

/** One cloud session of a meeting member's high-quality media for a recorded clip. */
export interface MeetingMediaSession {
  readonly sessionId: string
  /** The cloud provider that holds this session's files; `folder` is a path within it. */
  readonly provider: CloudProviderId
  readonly folder: string
  /** The clip's audio length when the session began: where its first frame is expected. */
  readonly priorFrame: number
  /** The recording segment the session belongs to, in clip samples. */
  readonly segmentStart: number
  segmentEnd: number | null
  /**
   * Where the session's audio landed in the clip, saved once its audio is patched in. Replacing the video maps frame
   * times through them; patching again to recover them would sharpen the crossfades at every run edge.
   */
  runs?: ReadonlyArray<{ readonly sessionSample: number; readonly filePosition: number; readonly length: number }>
}

/** The high-quality media a recorded clip waits for or was upgraded with. Peer sessions are live-only. */
export interface MeetingMedia {
  readonly username: string
  readonly sessions: MeetingMediaSession[]
  audio: 'pending' | 'done'
  video: 'pending' | 'replacing' | 'done' | 'kept'
}
