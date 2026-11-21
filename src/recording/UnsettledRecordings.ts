import { AudioControl } from '../audiocontext/AudioControl'

// Kept apart from Recorder so that switching or backing up projects can wait for recordings without loading the
// recording and media-import code, which stays out of the initial chunk.
const unsettledRecordings = new Set<Promise<void>>()

type Upgrade = { pause(): Promise<void>; resume(): void }
const upgrades = new Set<Upgrade>()
let pauseDepth = 0

/** `settled` must not reject: recording failures are reported by the recording's error handler. */
export function trackUnsettledRecording(settled: Promise<void>): void {
  unsettledRecordings.add(settled)
  void settled.finally(() => unsettledRecordings.delete(settled))
}

/** Background work that rewrites project files; it is paused while projects are switched, exported, or backed up. */
export function registerUpgrade(work: Upgrade): () => void {
  upgrades.add(work)
  if (pauseDepth > 0) void work.pause()
  return () => upgrades.delete(work)
}

export async function withUpgradesPaused<T>(operation: () => Promise<T>): Promise<T> {
  try {
    if (pauseDepth++ == 0) await Promise.all(Array.from(upgrades, (work) => work.pause()))
    return await operation()
  } finally {
    if (--pauseDepth == 0) upgrades.forEach((work) => work.resume())
  }
}

/**
 * Stops playback, monitoring, or recording, waits until every recording's audio is written and its video clips are
 * saved, then runs `operation` with upgrades paused. Recording failures were already reported by their error handler.
 */
export async function withRecordingsStopped<T>(operation: () => Promise<T>): Promise<T> {
  await AudioControl.stop()
  await Promise.all(unsettledRecordings)
  return withUpgradesPaused(operation)
}
