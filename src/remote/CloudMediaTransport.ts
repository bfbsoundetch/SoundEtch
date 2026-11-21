import type { UploadLink } from '../backup/CloudStorage'
import { CloudUnavailableError } from '../backup/CloudStorage'
import { contentHash } from '../backup/ContentHasher'
import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import { Logger } from '../global/Logger'
import type { VideoTrackRecorder, VideoTrackRecorderOptions } from '../recording/VideoTrackRecorder'
import { humanizeBytes } from '../ui/DiskUsage'
import { type Notification, NotificationsController } from '../ui/NotificationsController'
import { ChunkedUploadSink, type SealedVideoChunk } from './ChunkedUploadSink'
import { isAllowedUploadUrl, UploadLinkUnusableError } from './CloudUploadLink'
import type { FrameCapture } from './HighQualityAudioCapture'
import {
  HQ_AUDIO_CHUNK_FRAMES,
  HQ_AUDIO_CHUNK_HEADER_BYTES,
  HQ_FRAME_BYTES,
  HQ_SAMPLE_RATE,
  HQ_UPLOAD_SPOOL_DIRECTORY,
} from './HighQualityAudioFormat'
import type { HighQualityMessage } from './RemoteMediaClient3'

/** While the session is live, upload starts are at least this far apart, so a catch-up burst can't crowd the call. */
export const HQ_UPLOAD_MIN_INTERVAL_MS = 5000
/** Guests sharing a device hold this shared while they spool; whoever gets it exclusively may clear leftovers. */
export const HQ_UPLOAD_LOCK_NAME = 'soundetch-hq-upload'
export const MANIFEST_NAME = 'manifest.json'
const UNAVAILABLE_RETRY_MS = 30000
/** Gathers link requests for chunks sealed close together into one message. */
const LINK_REQUEST_DEBOUNCE_MS = 500
const MAX_REFUSED_UPLOADS = 3
const REFUSED_MESSAGE = 'The cloud storage rejected the upload; it may be full or the link expired.'

export type UploadFunction = (
  link: UploadLink,
  bytes: Uint8Array<ArrayBuffer>,
  signal?: AbortSignal,
) => Promise<string | null>

export type VideoRecorderLike = Pick<VideoTrackRecorder, 'attach' | 'finish'>

/** The part of the meeting client a cloud session talks to its recorder through. */
export interface CloudSessionChannel {
  sendHighQuality(peerId: string, message: HighQualityMessage): boolean
}

export interface CloudMediaTransportOptions {
  readonly channel: CloudSessionChannel
  readonly recorderPeerId: string
  /** Shown while uploads continue after leaving. */
  readonly recorderName: string
  readonly sessionId: string
  /** Whether the recorder records this member's camera, so the camera is uploaded too. */
  readonly video: boolean
  readonly capture: Pick<FrameCapture, 'elapsedSamples'>
  readonly createVideoRecorder: (options: VideoTrackRecorderOptions) => VideoRecorderLike
  readonly upload: UploadFunction
  /** Runs once when the session stops: completed, failed, cancelled or abandoned. */
  readonly onStopped: () => void
}

export interface CloudManifest {
  format: 'soundetch-meeting-media'
  version: 1
  sessionId: string
  /** The highest captured seq + 1. */
  frameCount: number
  audio: Array<{ name: string; firstSeq: number; frameCount: number; size: number; contentHash: string }>
  video: { codec: string; size: number; chunks: Array<{ name: string; size: number; contentHash: string }> } | null
  /** False when the video recorder failed; audio gaps show as missing seqs. */
  complete: boolean
}

type SpooledChunk = {
  readonly name: string
  readonly file: string
  readonly size: number
  readonly audio: { firstSeq: number; frameCount: number } | null
}

type NextUpload = { name: string; chunk: SpooledChunk | null }

const logger = new Logger('CloudMediaTransport')

export function audioChunkName(ordinal: number) {
  return `audio-${String(ordinal).padStart(5, '0')}.pcm`
}

/** The header of a spooled and uploaded audio chunk; the int16 frames follow it. */
export function audioChunkHeader(firstSeq: number, frameCount: number): Uint8Array<ArrayBuffer> {
  const header = new Uint8Array(HQ_AUDIO_CHUNK_HEADER_BYTES)
  header.set([0x53, 0x45, 0x48, 0x51]) // 'SEHQ'
  const view = new DataView(header.buffer)
  view.setUint16(4, 1, true)
  view.setUint16(6, 0, true)
  view.setUint32(8, firstSeq, true)
  view.setUint32(12, frameCount, true)
  return header
}

/**
 * One cloud session: spools the guest's high-quality audio (and camera) as chunk files, uploads each sealed chunk
 * through the links the recorder issues, and finally uploads a manifest. The spool holds only chunks not yet uploaded,
 * so this device never keeps a second copy of its media.
 */
export class CloudMediaTransport {
  /** Resolves once the session stopped and its spool files are gone. */
  readonly settled: Promise<void>
  private readonly filePrefix: string
  private readonly videoRecorder: VideoRecorderLike | null
  private readonly lockReady: Promise<void>
  private releaseLock = () => {}
  private readonly abort = new AbortController()
  private readonly links = new Map<string, UploadLink>()
  private sessionOrigin: string | null = null
  /** Names asked for and not yet received. */
  private readonly requested = new Set<string>()
  private readonly toRequest = new Set<string>()
  private requestTimer: ReturnType<typeof setTimeout> | undefined
  private readonly refusals = new Map<string, number>()
  /** Sealed chunks waiting for upload, oldest first. */
  private readonly queue = new Array<SpooledChunk>()
  /** Every spool file this session created, so cleanup deletes exactly those. */
  private readonly files = new Set<string>()
  private audio: { firstSeq: number; frames: ArrayBuffer[] } | null = null
  private audioOrdinal = 0
  private highestSeq = -1
  private writes: Promise<void>
  private readonly uploadedAudio = new Array<CloudManifest['audio'][number]>()
  private readonly uploadedVideo = new Array<{ name: string; size: number; contentHash: string }>()
  private videoCodec: string | null = null
  private videoFailed = false
  private lastUploadStart: number | null = null
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private uploading = false
  private rerun = false
  private ended = false
  /** Ended, with every chunk sealed and spooled: only uploads remain. */
  private finalized = false
  private manifestUploaded = false
  private detached = false
  private stopped = false
  private readonly resolveSettled: () => void
  private readonly linkWaiters = new Array<() => void>()
  private notification: Notification | null = null

  constructor(private readonly options: CloudMediaTransportOptions) {
    this.filePrefix = `${options.sessionId}-`
    const settled = Promise.withResolvers<void>()
    this.settled = settled.promise
    this.resolveSettled = settled.resolve
    this.lockReady = this.holdLock()
    this.writes = this.lockReady
    window.addEventListener('beforeunload', this.beforeUnload)
    this.videoRecorder = options.video
      ? options.createVideoRecorder({
          output: {
            kind: 'sink',
            open: async () => {
              await this.lockReady
              return new ChunkedUploadSink(
                HQ_UPLOAD_SPOOL_DIRECTORY,
                (chunk) => this.videoSealed(chunk),
                this.filePrefix,
              )
            },
          },
          sampleRate: HQ_SAMPLE_RATE,
          // Video timestamps are session samples, the same clock as the audio seqs.
          timeline: () => {
            const elapsed = options.capture.elapsedSamples()
            return { seconds: (elapsed ?? 0) / HQ_SAMPLE_RATE, running: elapsed != null }
          },
          minimumHeight: 0,
          onProgress: () => {},
          onError: (error) => this.videoError(error),
        })
      : null
  }

  addFrame(seq: number, pcm: ArrayBuffer) {
    if (this.ended || this.stopped) return
    this.highestSeq = Math.max(this.highestSeq, seq)
    if (this.audio && seq != this.audio.firstSeq + this.audio.frames.length) this.sealAudio()
    this.audio ??= { firstSeq: seq, frames: [] }
    this.audio.frames.push(pcm)
    if (this.audio.frames.length == HQ_AUDIO_CHUNK_FRAMES) this.sealAudio()
  }

  /** Records `track` from now on, or black while null. */
  attachVideo(track: MediaStreamTrack | null) {
    if (!this.ended && !this.stopped) this.videoRecorder?.attach(track)
  }

  addLinks(links: ReadonlyArray<{ name: string; method: 'POST' | 'PUT'; url: string }>) {
    if (this.stopped) return
    for (const { name, method, url } of links) {
      if (this.sessionOrigin == null) {
        try {
          this.sessionOrigin = new URL(url).origin
        } catch {
          logger.errorMessage(`Session ${this.options.sessionId}: ignoring a malformed upload link for ${name}`)
          continue
        }
      }
      if (!isAllowedUploadUrl(url, this.sessionOrigin)) {
        logger.errorMessage(`Session ${this.options.sessionId}: ignoring an upload link for ${name} to another origin`)
        continue
      }
      this.links.set(name, { method, url, singleUse: method == 'POST' })
      this.requested.delete(name)
      this.toRequest.delete(name)
    }
    this.checkLinked()
    this.kick()
  }

  /** Finishes the video, seals the audio, and uploads everything back to back, then the manifest. */
  async end(): Promise<void> {
    if (this.ended || this.stopped) return
    this.ended = true
    clearTimeout(this.retryTimer)
    try {
      await this.videoRecorder?.finish()
    } catch (error) {
      this.videoError(error instanceof Error ? error : new Error(String(error)))
    }
    this.sealAudio()
    await this.writes
    if (this.stopped) return
    this.finalized = true
    const unlinked = [...this.queue.map((chunk) => chunk.name), MANIFEST_NAME].filter((name) => !this.links.has(name))
    if (unlinked.length > 0) this.requestLinks(unlinked, true)
    this.checkLinked()
    this.kick()
  }

  /** Stops now and deletes the spool, sending nothing more. */
  cancel() {
    void this.stop()
  }

  /**
   * The meeting connection is closing: no more messages, and no more links. The session ends; chunks keep uploading
   * while their links last, and whatever has no link is deleted.
   */
  detach() {
    if (this.stopped) return
    this.detached = true
    clearTimeout(this.requestTimer)
    this.toRequest.clear()
    if (this.pendingBytes() > 0) {
      this.notification = NotificationsController.showLongDurationMessage(this.leavingMessage())
    }
    void this.end()
  }

  /** Resolves once the session ended and every remaining upload has its link, or the session stopped. */
  whenLinked(): Promise<void> {
    const { promise, resolve } = Promise.withResolvers<void>()
    this.linkWaiters.push(resolve)
    this.checkLinked()
    return promise
  }

  private async holdLock(): Promise<void> {
    const locks: LockManager | undefined = globalThis.navigator?.locks
    if (!locks) return
    const { promise: released, resolve: release } = Promise.withResolvers<void>()
    this.releaseLock = release
    const { promise: granted, resolve: grant } = Promise.withResolvers<void>()
    locks
      .request(HQ_UPLOAD_LOCK_NAME, { mode: 'shared' }, () => {
        grant()
        return released
      })
      .catch((error: unknown) => {
        logger.errorMessage(`Could not lock the upload spool: ${error}`)
        grant()
      })
    return granted
  }

  private sealAudio() {
    const audio = this.audio
    this.audio = null
    if (!audio || audio.frames.length == 0) return
    const name = audioChunkName(++this.audioOrdinal)
    const file = this.filePrefix + name
    const bytes = new Uint8Array(HQ_AUDIO_CHUNK_HEADER_BYTES + audio.frames.length * HQ_FRAME_BYTES)
    bytes.set(audioChunkHeader(audio.firstSeq, audio.frames.length))
    audio.frames.forEach((frame, index) =>
      bytes.set(new Uint8Array(frame), HQ_AUDIO_CHUNK_HEADER_BYTES + index * HQ_FRAME_BYTES),
    )
    const chunk: SpooledChunk = {
      name,
      file,
      size: bytes.byteLength,
      audio: { firstSeq: audio.firstSeq, frameCount: audio.frames.length },
    }
    this.files.add(file)
    this.writes = this.writes.then(async () => {
      if (this.stopped) return
      try {
        const writer = await FileSystemUtils.createFileWriter(HQ_UPLOAD_SPOOL_DIRECTORY, file)
        await writer.write(bytes)
        await writer.close()
      } catch (error) {
        this.failSpool(error)
        return
      }
      this.queue.push(chunk)
      this.kick()
    })
  }

  private videoSealed(sealed: SealedVideoChunk) {
    this.files.add(sealed.file)
    if (this.stopped) return
    this.queue.push({ name: sealed.name, file: sealed.file, size: sealed.size, audio: null })
    this.kick()
  }

  private videoError(error: Error) {
    // A full disk is a spool failure like any other; anything else only costs the video.
    if (error.name == 'QuotaExceededError') return this.failSpool(error)
    this.videoFailed = true
    logger.errorMessage(`Session ${this.options.sessionId}: the camera recording failed: ${error.message}`)
  }

  private failSpool(error: unknown) {
    this.fail(`Could not store high-quality media for upload: ${error instanceof Error ? error.message : error}`)
  }

  private fail(message: string) {
    if (this.stopped) return
    logger.errorMessage(`Session ${this.options.sessionId} failed: ${message}`)
    this.send({ type: 'hqFailed', sessionId: this.options.sessionId, message })
    void this.stop()
  }

  private send(message: HighQualityMessage) {
    if (!this.detached) this.options.channel.sendHighQuality(this.options.recorderPeerId, message)
  }

  /** Asks for links for `names`, gathering requests that arrive close together unless `now`. */
  private requestLinks(names: readonly string[], now = false) {
    if (this.detached) return
    for (const name of names) if (!this.requested.has(name)) this.toRequest.add(name)
    if (this.toRequest.size == 0) return
    clearTimeout(this.requestTimer)
    const flush = () => {
      const pending = [...this.toRequest]
      this.toRequest.clear()
      if (pending.length == 0 || this.stopped) return
      pending.forEach((name) => this.requested.add(name))
      this.send({ type: 'hqLinkRequest', sessionId: this.options.sessionId, names: pending })
    }
    if (now) flush()
    else this.requestTimer = setTimeout(flush, LINK_REQUEST_DEBOUNCE_MS)
  }

  private kick() {
    if (this.stopped) return
    if (this.uploading) {
      this.rerun = true
      return
    }
    this.uploading = true
    void (async () => {
      try {
        do {
          this.rerun = false
          await this.uploadAvailable()
        } while (this.rerun && !this.stopped)
      } catch (error) {
        logger.errorMessage(`Session ${this.options.sessionId}: uploading failed: ${error}`)
      } finally {
        this.uploading = false
      }
    })()
  }

  private nextUpload(): NextUpload | null {
    if (this.queue.length > 0) return { name: this.queue[0].name, chunk: this.queue[0] }
    if (this.finalized && !this.manifestUploaded) return { name: MANIFEST_NAME, chunk: null }
    return null
  }

  private async uploadAvailable() {
    while (!this.stopped) {
      const next = this.nextUpload()
      if (!next) return
      const link = this.links.get(next.name)
      if (!link) {
        // Without the meeting no more links come; what is left can't be uploaded.
        if (this.detached) {
          logger.log(`Session ${this.options.sessionId}: no link for ${next.name} after leaving; discarding the rest`)
          await this.stop()
          return
        }
        this.requestLinks([next.name])
        return
      }
      if (!this.ended && this.lastUploadStart != null) {
        const wait = this.lastUploadStart + HQ_UPLOAD_MIN_INTERVAL_MS - Date.now()
        if (wait > 0) {
          this.retryAfter(wait)
          return
        }
      }
      this.lastUploadStart = Date.now()
      let bytes: Uint8Array<ArrayBuffer>
      try {
        bytes = next.chunk ? await this.readSpool(next.chunk.file) : this.manifestBytes()
      } catch (error) {
        this.failSpool(error)
        return
      }
      if (this.stopped) return
      const hash = await contentHash(bytes)
      if (next.chunk?.name == 'video-00001.part') this.videoCodec ??= detectVideoCodec(bytes)
      let reported: string | null
      try {
        reported = await this.options.upload(link, bytes, this.abort.signal)
      } catch (error) {
        if (this.stopped) return
        if (error instanceof CloudUnavailableError) {
          logger.log(`Session ${this.options.sessionId}: ${error.message} Retrying ${next.name} later.`)
          this.retryAfter(UNAVAILABLE_RETRY_MS)
          return
        }
        if (!(error instanceof UploadLinkUnusableError)) {
          logger.errorMessage(`Session ${this.options.sessionId}: uploading ${next.name} failed: ${error}`)
        }
        if (!this.refused(next.name)) return
        continue
      }
      if (this.stopped) return
      // Dropbox reports what it stored; a mismatch means the cloud copy is not this chunk.
      if (reported != null && reported != hash) {
        logger.errorMessage(`Session ${this.options.sessionId}: the cloud copy of ${next.name} does not match`)
        if (!this.refused(next.name)) return
        continue
      }
      this.uploaded(next, bytes.byteLength, hash)
      if (next.chunk) await this.deleteSpoolFile(next.chunk.file)
    }
  }

  /** Forgets the link and asks for another; false once too many in a row failed, which fails the session. */
  private refused(name: string): boolean {
    this.links.delete(name)
    const count = (this.refusals.get(name) ?? 0) + 1
    this.refusals.set(name, count)
    if (count >= MAX_REFUSED_UPLOADS) {
      this.fail(REFUSED_MESSAGE)
      return false
    }
    this.requestLinks([name], this.ended)
    return true
  }

  private uploaded(next: NextUpload, size: number, hash: string) {
    this.links.delete(next.name)
    this.refusals.delete(next.name)
    this.send({ type: 'hqUploaded', sessionId: this.options.sessionId, name: next.name, size, contentHash: hash })
    const chunk = next.chunk
    if (!chunk) {
      this.manifestUploaded = true
      this.send({ type: 'hqComplete', sessionId: this.options.sessionId })
      void this.stop()
      return
    }
    this.queue.shift()
    if (chunk.audio) this.uploadedAudio.push({ name: chunk.name, ...chunk.audio, size, contentHash: hash })
    else this.uploadedVideo.push({ name: chunk.name, size, contentHash: hash })
    this.notification?.updateMessage(this.leavingMessage())
  }

  private manifestBytes(): Uint8Array<ArrayBuffer> {
    const manifest: CloudManifest = {
      format: 'soundetch-meeting-media',
      version: 1,
      sessionId: this.options.sessionId,
      frameCount: this.highestSeq + 1,
      audio: this.uploadedAudio,
      video:
        this.uploadedVideo.length > 0
          ? {
              codec: this.videoCodec ?? 'unknown',
              size: this.uploadedVideo.reduce((total, chunk) => total + chunk.size, 0),
              chunks: this.uploadedVideo,
            }
          : null,
      complete: !this.videoFailed,
    }
    return new TextEncoder().encode(JSON.stringify(manifest))
  }

  private async readSpool(file: string): Promise<Uint8Array<ArrayBuffer>> {
    const blob = await FileSystemUtils.getExistingFile(HQ_UPLOAD_SPOOL_DIRECTORY, file)
    return new Uint8Array(await blob.arrayBuffer())
  }

  private async deleteSpoolFile(file: string) {
    try {
      await FileSystemUtils.deleteFile(HQ_UPLOAD_SPOOL_DIRECTORY, file)
      this.files.delete(file)
    } catch (error) {
      logger.errorMessage(`Could not delete the uploaded spool file ${file}: ${error}`)
    }
  }

  private retryAfter(milliseconds: number) {
    clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => this.kick(), milliseconds)
  }

  private checkLinked() {
    const linked =
      this.stopped ||
      (this.finalized &&
        this.queue.every((chunk) => this.links.has(chunk.name)) &&
        (this.manifestUploaded || this.links.has(MANIFEST_NAME)))
    if (linked) this.linkWaiters.splice(0).forEach((resolve) => resolve())
  }

  private pendingBytes(): number {
    const queued = this.queue.reduce((total, chunk) => total + chunk.size, 0)
    return queued + (this.audio?.frames.length ?? 0) * HQ_FRAME_BYTES
  }

  private leavingMessage() {
    return `Finishing the high-quality upload for ${this.options.recorderName} (${humanizeBytes(this.pendingBytes())} left). Keep this tab open.`
  }

  private readonly beforeUnload = (event: BeforeUnloadEvent) => {
    if (!this.stopped && (this.ended || this.queue.length > 0)) event.preventDefault()
  }

  private async stop() {
    if (this.stopped) return
    this.stopped = true
    this.abort.abort()
    clearTimeout(this.retryTimer)
    clearTimeout(this.requestTimer)
    window.removeEventListener('beforeunload', this.beforeUnload)
    this.notification?.remove()
    this.checkLinked()
    this.options.onStopped()
    try {
      // Closing the sink reports every chunk file it opened, so cleanup knows them all.
      await this.videoRecorder?.finish()
    } catch {
      // A failed recorder has closed its sink already.
    }
    await this.writes
    for (const file of [...this.files]) await this.deleteSpoolFile(file)
    this.releaseLock()
    this.resolveSettled()
  }
}

/** The codec of a fragmented MP4's video track, from its sample entry in the first chunk. */
function detectVideoCodec(bytes: Uint8Array): string | null {
  const entries: Record<string, string> = {
    avc1: 'avc',
    avc3: 'avc',
    vp09: 'vp9',
    av01: 'av1',
    hvc1: 'hevc',
    hev1: 'hevc',
  }
  const limit = Math.min(bytes.length, 65536) - 4
  for (let i = 0; i <= limit; i++) {
    const type = String.fromCharCode(bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3])
    if (type in entries) return entries[type]
  }
  return null
}
