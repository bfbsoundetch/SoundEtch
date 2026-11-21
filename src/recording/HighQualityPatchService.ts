import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import type { FileSystemSyncAccessHandle } from '../filesystem/FileSystemSyncAccessHandle'
import { Logger } from '../global/Logger'
import { Summary } from '../project/Summary'
import { mixSpan, StreamingAligner } from '../remote/HighQualityAlignment'
import type { PatchSpan, Run } from '../remote/HighQualityAlignment'
import { HQ_FRAME_BYTES, HQ_FRAME_SAMPLES } from '../remote/HighQualityAudioFormat'
import { LiveRecordingFiles } from './LiveRecordingFiles'

/** How long a patch waits before reopening a file that a reader (playback, export, transcription) holds. */
export const HQ_PATCH_RETRY_MS = 1000
/** How often a session patching a recording in progress checks whether the recording reached its next block. */
const LIVE_POLL_MS = 1000

export type PatchRequest =
  | {
      type: 'open'
      key: string
      dirname: string
      filename: string
      priorFrame: number
      segmentStart: number
      segmentEnd: number | null
    }
  /** `pcm` holds n·HQ_FRAME_BYTES of consecutive seqs from `firstSeq`. */
  | { type: 'frames'; key: string; firstSeq: number; pcm: ArrayBuffer }
  | { type: 'segmentEnd'; key: string; end: number }
  | { type: 'finish'; key: string; frameCount: number }
  | { type: 'abort'; key: string }
  | { type: 'pause' }
  | { type: 'resume' }

export interface PatchStats {
  blocks: number
  confident: number
  hqSamples: number
}

export type PatchReply =
  /**
   * After every batch. `[patchedStart, patchedEnd)` spans the file samples the session patched so far (both 0 before
   * any); `summaryOnDisk` means only the summary file has the new buckets, not the recording's shared summary.
   */
  | {
      type: 'progress'
      key: string
      patchedStart: number
      patchedEnd: number
      summaryOnDisk: boolean
      heldFrames: number
    }
  | { type: 'paused' }
  | { type: 'done'; key: string; stats: PatchStats; runs: Run[] }
  | { type: 'failed'; key: string; name: string; message: string }

type SyncAccessFileHandle = FileSystemFileHandle & { createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle> }

interface PatchSession {
  readonly key: string
  readonly dirname: string
  readonly filename: string
  /** The clip's audio file, as `LiveRecordingFiles` knows it; batches on one file run one at a time. */
  readonly fileKey: string
  readonly aligner: StreamingAligner
  timer: ReturnType<typeof setTimeout> | null
  timerDue: number
  running: Promise<void> | null
  /** A message arrived since the last batch started, so another batch may make progress. */
  dirty: boolean
  /** A reader holds the file; no batch starts before this time. */
  blockedUntil: number
  patchedStart: number
  patchedEnd: number
  ended: boolean
}

type BatchOutcome = { kind: 'skipped' } | { kind: 'blocked' } | { kind: 'ran'; progressed: boolean; live: boolean }

const logger = new Logger('HighQualityPatchService')
/** Shared by every port: a recording's port and an upgrade's port may patch one file. */
const fileLocks = new Map<string, Promise<void>>()

async function withFileLock<T>(fileKey: string, work: () => Promise<T>): Promise<T> {
  const previous = fileLocks.get(fileKey) ?? Promise.resolve()
  const { promise: released, resolve: release } = Promise.withResolvers<void>()
  const tail = previous.then(() => released)
  fileLocks.set(fileKey, tail)
  await previous
  try {
    return await work()
  } finally {
    release()
    if (fileLocks.get(fileKey) === tail) fileLocks.delete(fileKey)
  }
}

/**
 * Serves one `MessagePort` of high-quality patch requests in the writing worker. Each session (key) aligns a
 * member's high-quality frames on that member's recorded clip and mixes them into the clip's audio file in place,
 * borrowing the recording's handles while it is still being written.
 */
export function attachPatchPort(port: MessagePort): void {
  new PatchPort(port)
}

class PatchPort {
  private readonly sessions = new Map<string, PatchSession>()
  private paused = false

  constructor(private readonly port: MessagePort) {
    port.addEventListener('message', (event: MessageEvent<PatchRequest>) => this.handle(event.data))
    port.start()
  }

  private handle(request: PatchRequest) {
    switch (request.type) {
      case 'pause':
        void this.pause()
        return
      case 'resume':
        this.paused = false
        this.sessions.forEach((session) => this.schedule(session, 0))
        return
      case 'open':
        this.open(request)
        return
    }
    const session = this.sessions.get(request.key)
    if (!session) return
    switch (request.type) {
      case 'frames': {
        const frameCount = Math.floor(request.pcm.byteLength / HQ_FRAME_BYTES)
        for (let index = 0; index < frameCount; ++index) {
          session.aligner.addFrame(
            request.firstSeq + index,
            new Int16Array(request.pcm, index * HQ_FRAME_BYTES, HQ_FRAME_SAMPLES),
          )
        }
        break
      }
      case 'segmentEnd':
        session.aligner.setSegmentEnd(request.end)
        break
      case 'finish':
        session.aligner.finish(request.frameCount)
        break
      case 'abort':
        // What was patched stays patched; a running batch completes, as its writes are already under way.
        this.end(session)
        return
    }
    session.dirty = true
    this.schedule(session, 0)
  }

  private open(request: Extract<PatchRequest, { type: 'open' }>) {
    if (this.sessions.has(request.key)) {
      this.port.postMessage({
        type: 'failed',
        key: request.key,
        name: 'InvalidStateError',
        message: `Patch session ${request.key} is already open`,
      } satisfies PatchReply)
      return
    }
    const aligner = new StreamingAligner({ priorFrame: request.priorFrame, segmentStart: request.segmentStart })
    if (request.segmentEnd !== null) aligner.setSegmentEnd(request.segmentEnd)
    this.sessions.set(request.key, {
      key: request.key,
      dirname: request.dirname,
      filename: request.filename,
      fileKey: `${request.dirname}/${request.filename}`,
      aligner,
      timer: null,
      timerDue: 0,
      running: null,
      dirty: false,
      blockedUntil: 0,
      patchedStart: 0,
      patchedEnd: 0,
      ended: false,
    })
  }

  private async pause() {
    this.paused = true
    for (const session of this.sessions.values()) this.clearTimer(session)
    const running = [...this.sessions.values()].flatMap((session) => (session.running ? [session.running] : []))
    await Promise.all(running)
    this.port.postMessage({ type: 'paused' } satisfies PatchReply)
  }

  private schedule(session: PatchSession, delay: number) {
    if (session.ended || this.paused || session.running) return
    const due = Math.max(Date.now() + delay, session.blockedUntil)
    if (session.timer !== null) {
      if (session.timerDue <= due) return
      this.clearTimer(session)
    }
    session.timerDue = due
    // A timer, never a microtask, so each batch is its own macrotask and recording writes interleave with them.
    session.timer = setTimeout(
      () => {
        session.timer = null
        void this.runBatch(session)
      },
      Math.max(0, due - Date.now()),
    )
  }

  private clearTimer(session: PatchSession) {
    if (session.timer === null) return
    clearTimeout(session.timer)
    session.timer = null
  }

  private async runBatch(session: PatchSession) {
    if (session.ended || this.paused) return
    session.dirty = false
    const { promise: running, resolve: settle } = Promise.withResolvers<void>()
    session.running = running
    let outcome: BatchOutcome
    try {
      outcome = await withFileLock(session.fileKey, () => this.batch(session))
    } catch (error) {
      this.fail(session, error)
      return
    } finally {
      session.running = null
      settle()
    }

    if (outcome.kind === 'blocked') {
      session.blockedUntil = Date.now() + HQ_PATCH_RETRY_MS
      this.schedule(session, HQ_PATCH_RETRY_MS)
      return
    }
    if (outcome.kind === 'skipped') {
      // Paused or aborted while waiting for the file; resuming reschedules.
      session.dirty = true
      return
    }
    this.port.postMessage({
      type: 'progress',
      key: session.key,
      patchedStart: session.patchedStart,
      patchedEnd: session.patchedEnd,
      summaryOnDisk: !outcome.live,
      heldFrames: session.aligner.heldFrames,
    } satisfies PatchReply)
    if (session.aligner.finished) {
      this.end(session)
      this.port.postMessage({
        type: 'done',
        key: session.key,
        stats: { ...session.aligner.stats },
        runs: session.aligner.runs.map((run) => ({ ...run })),
      } satisfies PatchReply)
      return
    }
    if (outcome.progressed || session.dirty) {
      this.schedule(session, 0)
    } else if (outcome.live) {
      // The recording grows in real time, so its next block becomes alignable without any message.
      this.schedule(session, LIVE_POLL_MS)
    }
  }

  /** One aligned block at most, with every span it releases written to the file and its summary. */
  private async batch(session: PatchSession): Promise<BatchOutcome> {
    if (session.ended || this.paused) return { kind: 'skipped' }
    const live = LiveRecordingFiles.get(session.fileKey)
    if (live) {
      // A recording's handles stay open; its writer appends past `available` while this runs synchronously.
      const progressed = this.patch(session, live.handle, live.summary, live.writtenFrames())
      return { kind: 'ran', progressed, live: true }
    }

    const handles = await this.openExclusively(session)
    if (!handles) return { kind: 'blocked' }
    let failure: unknown = null
    let progressed = false
    try {
      const summary = new Summary(1)
      summary.setSyncFileHandle(handles.summary)
      const available = Math.floor(handles.audio.getSize() / Float32Array.BYTES_PER_ELEMENT)
      progressed = this.patch(session, handles.audio, summary, available)
    } catch (error) {
      failure = error
    }
    // Closed after every batch, so playback and export can open the files between batches.
    for (const handle of [handles.audio, handles.summary]) {
      try {
        handle.close()
      } catch (error) {
        failure ??= error
      }
    }
    if (failure !== null) throw failure
    return { kind: 'ran', progressed, live: false }
  }

  /** Null while a reader holds either file; a deleted clip throws `NotFoundError` and creates nothing. */
  private async openExclusively(
    session: PatchSession,
  ): Promise<{ audio: FileSystemSyncAccessHandle; summary: FileSystemSyncAccessHandle } | null> {
    const open = async (filename: string) => {
      const file = (await FileSystemUtils.getExistingFileHandle(session.dirname, filename)) as SyncAccessFileHandle
      return file.createSyncAccessHandle()
    }
    let audio: FileSystemSyncAccessHandle
    try {
      audio = await open(session.filename)
    } catch (error) {
      if (isNoModificationAllowed(error)) return null
      throw error
    }
    try {
      return { audio, summary: await open(`${session.filename}_summary`) }
    } catch (error) {
      audio.close()
      if (isNoModificationAllowed(error)) return null
      throw error
    }
  }

  /** Returns whether the aligner did any work, so another batch right away may do more. */
  private patch(
    session: PatchSession,
    handle: FileSystemSyncAccessHandle,
    summary: Summary,
    available: number,
  ): boolean {
    const { aligner } = session
    const blocksBefore = aligner.stats.blocks
    const finishedBefore = aligner.finished
    const spans = aligner.advance((start, end) => readSamples(handle, start, end, available), available, 1)
    for (const span of spans) {
      this.patchSpan(session, handle, summary, span, available)
      aligner.release(span.sessionSample + span.length)
    }
    return spans.length > 0 || aligner.stats.blocks !== blocksBefore || aligner.finished !== finishedBefore
  }

  private patchSpan(
    session: PatchSession,
    handle: FileSystemSyncAccessHandle,
    summary: Summary,
    span: PatchSpan,
    available: number,
  ) {
    const start = Math.max(0, span.filePosition)
    // Patching never grows the file, even if a segment end claims more audio than it holds.
    const end = Math.min(available, span.filePosition + span.length)
    if (end <= start) return
    const clipped: PatchSpan = {
      ...span,
      filePosition: start,
      sessionSample: span.sessionSample + start - span.filePosition,
      length: end - start,
    }
    const hq = session.aligner.samples(clipped)
    const output = readSamples(handle, start, end, available)
    mixSpan(output, clipped, hq)
    writeSamples(handle, output, start)
    handle.flush()

    const firstBucket = Math.floor(start / Summary.SAMPLES_PER_SUMMARY)
    const bucketsEnd = Math.min(available, Math.ceil(end / Summary.SAMPLES_PER_SUMMARY) * Summary.SAMPLES_PER_SUMMARY)
    const fileSamples = readSamples(handle, firstBucket * Summary.SAMPLES_PER_SUMMARY, bucketsEnd, available)
    summary.overwriteBuckets(firstBucket, Summary.computeBuckets(fileSamples, 1))

    if (session.patchedEnd === session.patchedStart) {
      session.patchedStart = start
      session.patchedEnd = end
    } else {
      session.patchedStart = Math.min(session.patchedStart, start)
      session.patchedEnd = Math.max(session.patchedEnd, end)
    }
  }

  private fail(session: PatchSession, error: unknown) {
    if (session.ended) return
    this.end(session)
    const name = error instanceof Error || error instanceof DOMException ? error.name : 'Error'
    const message = error instanceof Error || error instanceof DOMException ? error.message : String(error)
    logger.errorMessage(`Patching ${session.fileKey} failed: ${name}: ${message}`)
    this.port.postMessage({ type: 'failed', key: session.key, name, message } satisfies PatchReply)
  }

  private end(session: PatchSession) {
    session.ended = true
    this.clearTimer(session)
    if (this.sessions.get(session.key) === session) this.sessions.delete(session.key)
  }
}

/** Mono samples `[start, end)` of the file, zeros outside `[0, available)`. */
function readSamples(handle: FileSystemSyncAccessHandle, start: number, end: number, available: number): Float32Array {
  const output = new Float32Array(Math.max(0, end - start))
  const from = Math.max(0, start)
  const to = Math.min(end, available)
  if (to <= from) return output
  const bytes = new Uint8Array(output.buffer, (from - start) * Float32Array.BYTES_PER_ELEMENT, (to - from) * 4)
  let read = 0
  while (read < bytes.byteLength) {
    const count = handle.read(bytes.subarray(read), { at: from * Float32Array.BYTES_PER_ELEMENT + read })
    if (count <= 0) break
    read += count
  }
  return output
}

function writeSamples(handle: FileSystemSyncAccessHandle, samples: Float32Array, position: number) {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength)
  let written = 0
  while (written < bytes.byteLength) {
    const count = handle.write(bytes.subarray(written), {
      at: position * Float32Array.BYTES_PER_ELEMENT + written,
    })
    if (count <= 0) throw new Error('Audio file write made no progress')
    written += count
  }
}

function isNoModificationAllowed(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NoModificationAllowedError'
}
