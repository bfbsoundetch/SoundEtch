import { AudioControl } from '../audiocontext/AudioControl'

// Kept apart from Recorder so that switching or backing up projects can wait for recordings without loading the
// recording and media-import code, which stays out of the initial chunk.
const unsettledRecordings = new Set<Promise<void>>()

/** `settled` must not reject: recording failures are reported by the recording's error handler. */
export function trackUnsettledRecording(settled: Promise<void>): void {
  unsettledRecordings.add(settled)
  void settled.finally(() => unsettledRecordings.delete(settled))
}

/**
 * Stops playback, monitoring, or recording, then waits until every recording's audio is written and its video clips
 * are saved. Failures were already reported by the recording's error handler.
 */
export async function stopAndWaitForRecordings(): Promise<void> {
  await AudioControl.stop()
  await Promise.all(unsettledRecordings)
}
