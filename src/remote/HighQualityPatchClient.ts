import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import { Logger } from '../global/Logger'
import type { Clip } from '../project/Clip'
import type { PatchReply, PatchRequest, PatchStats } from '../recording/HighQualityPatchService'
import type { TrackListController } from '../ui/timeline/TrackListController'
import type { Run } from './HighQualityAlignment'

export type { PatchStats }

export interface PatchHandlers {
  onProgress?(progress: { patchedStart: number; patchedEnd: number; heldFrames: number }): void
  onDone(result: { stats: PatchStats; runs: Run[] }): void
  onFailed(error: { name: string; message: string }): void
}

type PatchClientWindow = typeof window & { readonly trackListController?: TrackListController }

/** Reloading a whole summary file costs a read of it, so a closed-file upgrade shows its waveform in steps. */
const SUMMARY_RELOAD_INTERVAL_MS = 5000
const REDRAW_INTERVAL_MS = 2000

interface PatchEntry {
  readonly clip: Clip
  readonly dirname: string
  /** Null once the session is done, failed or aborted; its last summary reload and redraw still happen. */
  handlers: PatchHandlers | null
  /** Patches reached only the summary file, so `clip.summary` must be reloaded from it. */
  summaryStale: boolean
  lastReload: number
  reloadTimer: ReturnType<typeof setTimeout> | null
  reloading: Promise<void>
  redrawPending: boolean
  lastRedraw: number
  redrawTimer: ReturnType<typeof setTimeout> | null
  /** The patched range at the last progress; only a change means new audio to show. */
  patchedStart: number
  patchedEnd: number
}

/** The main thread's side of a `HighQualityPatchService` port: typed requests, per-session callbacks, UI refresh. */
export class HighQualityPatchClient {
  private readonly logger = new Logger('HighQualityPatchClient')
  private readonly entries = new Map<string, PatchEntry>()
  private readonly pauseWaiters = new Array<() => void>()
  private closed = false

  constructor(private readonly port: MessagePort) {
    port.addEventListener('message', (event: MessageEvent<PatchReply>) => this.handle(event.data))
    port.start()
  }

  /** Starts patching `clip`'s audio file in `dirname` under `key`; the client reloads the clip's summary and redraws as progress arrives. */
  open(
    options: {
      key: string
      clip: Clip
      dirname: string
      priorFrame: number
      segmentStart: number
      segmentEnd: number | null
    },
    handlers: PatchHandlers,
  ): void {
    const { key, clip, dirname, priorFrame, segmentStart, segmentEnd } = options
    this.entries.set(key, {
      clip,
      dirname,
      handlers,
      summaryStale: false,
      patchedStart: 0,
      patchedEnd: 0,
      lastReload: 0,
      reloadTimer: null,
      reloading: Promise.resolve(),
      redrawPending: false,
      lastRedraw: 0,
      redrawTimer: null,
    })
    this.post({ type: 'open', key, dirname, filename: clip.filename, priorFrame, segmentStart, segmentEnd })
  }

  /** `pcm` holds n·HQ_FRAME_BYTES of consecutive seqs from `firstSeq`; it is transferred. */
  frames(key: string, firstSeq: number, pcm: ArrayBuffer): void {
    this.post({ type: 'frames', key, firstSeq, pcm }, [pcm])
  }

  segmentEnd(key: string, end: number): void {
    this.post({ type: 'segmentEnd', key, end })
  }

  finish(key: string, frameCount: number): void {
    this.post({ type: 'finish', key, frameCount })
  }

  abort(key: string): void {
    this.post({ type: 'abort', key })
    const entry = this.entries.get(key)
    if (entry) this.settle(key, entry)
  }

  /** Resolves once the worker finished its current batches and starts no more until `resume()`. */
  pause(): Promise<void> {
    if (this.closed) return Promise.resolve()
    const { promise, resolve } = Promise.withResolvers<void>()
    this.pauseWaiters.push(resolve)
    this.post({ type: 'pause' })
    return promise
  }

  resume(): void {
    this.post({ type: 'resume' })
  }

  /** Closes the port; pending keys get no further callbacks. */
  close(): void {
    if (this.closed) return
    // The worker can't see a port close, so live sessions would otherwise keep polling their recordings.
    for (const key of this.entries.keys()) this.post({ type: 'abort', key })
    this.closed = true
    this.port.close()
    for (const [key, entry] of this.entries) this.settle(key, entry)
    this.pauseWaiters.splice(0).forEach((resolve) => resolve())
  }

  private post(message: PatchRequest, transfer: Transferable[] = []) {
    if (this.closed) return
    this.port.postMessage(message, transfer)
  }

  private handle(reply: PatchReply) {
    if (reply.type === 'paused') {
      this.pauseWaiters.shift()?.()
      return
    }
    const entry = this.entries.get(reply.key)
    if (!entry?.handlers) return
    const handlers = entry.handlers
    switch (reply.type) {
      case 'progress':
        if (reply.patchedStart !== entry.patchedStart || reply.patchedEnd !== entry.patchedEnd) {
          entry.patchedStart = reply.patchedStart
          entry.patchedEnd = reply.patchedEnd
          entry.summaryStale ||= reply.summaryOnDisk
          this.scheduleRefresh(entry)
        }
        handlers.onProgress?.({
          patchedStart: reply.patchedStart,
          patchedEnd: reply.patchedEnd,
          heldFrames: reply.heldFrames,
        })
        return
      case 'done':
        this.settle(reply.key, entry)
        handlers.onDone({ stats: reply.stats, runs: reply.runs })
        return
      case 'failed':
        this.settle(reply.key, entry)
        handlers.onFailed({ name: reply.name, message: reply.message })
        return
    }
  }

  /** Drops the session's handlers and shows whatever it patched right away. */
  private settle(key: string, entry: PatchEntry) {
    entry.handlers = null
    if (this.entries.get(key) === entry) this.entries.delete(key)
    clearTimeout(entry.reloadTimer ?? undefined)
    clearTimeout(entry.redrawTimer ?? undefined)
    entry.reloadTimer = null
    entry.redrawTimer = null
    if (entry.summaryStale) {
      void this.reloadSummary(entry).then(() => this.redraw(entry))
    } else if (entry.redrawPending) {
      this.redraw(entry)
    }
  }

  private scheduleRefresh(entry: PatchEntry) {
    const now = performance.now()
    entry.redrawPending = true
    if (entry.summaryStale && entry.reloadTimer === null) {
      entry.reloadTimer = setTimeout(
        () => {
          entry.reloadTimer = null
          void this.reloadSummary(entry).then(() => this.redraw(entry))
        },
        Math.max(0, entry.lastReload + SUMMARY_RELOAD_INTERVAL_MS - now),
      )
    }
    if (!entry.summaryStale && entry.redrawTimer === null) {
      entry.redrawTimer = setTimeout(
        () => {
          entry.redrawTimer = null
          this.redraw(entry)
        },
        Math.max(0, entry.lastRedraw + REDRAW_INTERVAL_MS - now),
      )
    }
  }

  private reloadSummary(entry: PatchEntry): Promise<void> {
    entry.reloading = entry.reloading.then(async () => {
      if (!entry.summaryStale) return
      entry.summaryStale = false
      entry.lastReload = performance.now()
      const { clip, dirname } = entry
      try {
        const [summaryFile, audioFile] = await Promise.all([
          FileSystemUtils.getExistingFileHandle(dirname, `${clip.filename}_summary`).then((file) => file.getFile()),
          FileSystemUtils.getExistingFileHandle(dirname, clip.filename).then((file) => file.getFile()),
        ])
        await clip.summary.populateFromFile(summaryFile, audioFile, 1)
      } catch (error) {
        // A batch that changed the file mid-read makes its `File` unreadable; the next progress or the end retries.
        entry.summaryStale = true
        this.logger.log(`Could not reload the summary of clip ${clip.id}: ${error}`)
      }
    })
    return entry.reloading
  }

  private redraw(entry: PatchEntry) {
    entry.redrawPending = false
    entry.lastRedraw = performance.now()
    const clipId = entry.clip.id
    if (clipId === undefined) return
    ;(window as PatchClientWindow).trackListController?.clipAudioChanged(clipId)
  }
}
