import { CLOUD_PROVIDER_NAMES, getCloudStorage, isProviderConnected } from '../backup/CloudProviders'
import { CloudUnavailableError, type CloudFile, type CloudProviderId, type CloudStorage } from '../backup/CloudStorage'
import { contentHash, ContentHasher } from '../backup/ContentHasher'
import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import { Logger } from '../global/Logger'
import type { Clip } from '../project/Clip'
import type { MeetingMedia, MeetingMediaSession } from '../project/MeetingMedia'
import type { Project } from '../project/Project'
import { ProjectManager } from '../project/ProjectManager'
import type { VideoSegment } from '../project/Video'
import { registerUpgrade } from '../recording/UnsettledRecordings'
import { humanizeBytes } from '../ui/DiskUsage'
import { NotificationsController } from '../ui/NotificationsController'
import type { Run } from './HighQualityAlignment'
import {
  HQ_AUDIO_CHUNK_FRAMES,
  HQ_AUDIO_CHUNK_HEADER_BYTES,
  HQ_FRAME_BYTES,
  HQ_MAX_FRAME_SEQ,
  HQ_VIDEO_CHUNK_BYTES,
} from './HighQualityAudioFormat'
import { HighQualityPatchClient, type PatchStats } from './HighQualityPatchClient'
import type { RemuxRequest } from './MeetingMediaRemux'

/** A session that is no longer live and whose files stopped changing this long ago has uploaded all it will. */
export const HQ_STALE_UPLOAD_MS = 600000
export const HQ_POLL_INTERVAL_MS = 120000
/**
 * Frames posted to the patch service but not yet patched; bounds the HQ audio held in memory. Above the ~700 frames
 * the aligner holds behind a minute of silence before it resolves the oldest block.
 */
export const HQ_MAX_INFLIGHT_FRAMES = 1000
/** Free browser storage kept beyond the replacement video's growth. */
export const HQ_STORAGE_HEADROOM_BYTES = 268435456

/** What the meeting knows about sessions whose guests are still connected. */
export type LiveCloudSessions = {
  isLive(sessionId: string): boolean
  /** The guest reported the upload complete or failed. */
  isFinal(sessionId: string): boolean
}

/** Injected so that tests run without workers, WebCodecs, OPFS quotas or real time. */
export interface UpgradeDependencies {
  getStorage(provider: CloudProviderId): CloudStorage
  isConnected(provider: CloudProviderId): Promise<boolean>
  openPatchPort(): Promise<MessagePort>
  remux(request: RemuxRequest): Promise<VideoSegment>
  /** False once the project was closed, so a run stops instead of polling for a project nobody looks at. */
  isProjectOpen(project: Project): Promise<boolean>
  /** Bytes the origin may still store, or null when the browser cannot tell. */
  freeStorageBytes(): Promise<number | null>
  now(): number
  sleep(milliseconds: number): Promise<void>
}

interface ManifestFile {
  readonly name: string
  readonly size: number
  readonly contentHash: string
}

interface ManifestAudioChunk extends ManifestFile {
  readonly firstSeq: number
  readonly frameCount: number
}

interface Manifest {
  readonly frameCount: number
  readonly audio: readonly ManifestAudioChunk[]
  readonly video: { readonly codec: string; readonly size: number; readonly chunks: readonly ManifestFile[] } | null
  readonly complete: boolean
}

interface AudioChunkRef {
  readonly name: string
  readonly size: number
  readonly contentHash: string | null
  readonly firstSeq: number | null
  readonly frameCount: number | null
}

interface SessionFiles {
  readonly session: MeetingMediaSession
  /** null when the session's folder is gone or never received a file. */
  readonly files: readonly CloudFile[] | null
  readonly manifest: Manifest | null
}

interface RunRequest {
  readonly project: Project
  readonly clip: Clip
  readonly liveSessions: LiveCloudSessions | null
}

interface RunEntry {
  request: RunRequest
  /** Scheduled again while running: the run re-checks now and runs once more when it ends. */
  again: boolean
  wake: () => void
  readonly done: Promise<void>
}

const MANIFEST_NAME = 'manifest.json'
const MAX_MANIFEST_BYTES = 1024 * 1024
const AUDIO_CHUNK_NAME = /^audio-\d{5}\.pcm$/
const VIDEO_CHUNK_NAME = /^video-\d{5}\.part$/
/** Frames per `frames` message: one alignment block, so progress arrives about once per message. */
const FRAMES_PER_POST = 50
const CHUNK_MAGIC = 'SEHQ'

const logger = new Logger('MeetingMediaUpgrade')

export function needsUpgrade(media: MeetingMedia): boolean {
  return media.audio == 'pending' || media.video == 'pending' || media.video == 'replacing'
}

/**
 * Replaces recorded meeting clips' audio and video with what guests uploaded to cloud storage, once the uploads are
 * final. At most one run per clip; every run pauses with the other upgrades while projects are switched or saved.
 */
export class MeetingMediaUpgrades {
  private readonly entries = new Map<string, RunEntry>()

  constructor(private readonly deps: UpgradeDependencies) {}

  /** Resolves when the clip's run, and any run scheduled while it ran, has ended. */
  schedule(project: Project, clip: Clip, options: { liveSessions?: LiveCloudSessions } = {}): Promise<void> {
    const key = `${project.directoryName}/${clip.filename}`
    const running = this.entries.get(key)
    if (running) {
      running.request = { project, clip, liveSessions: options.liveSessions ?? running.request.liveSessions }
      running.again = true
      running.wake()
      return running.done
    }
    const entry: RunEntry = {
      request: { project, clip, liveSessions: options.liveSessions ?? null },
      again: false,
      wake: () => {},
      done: Promise.resolve().then(async () => {
        try {
          do {
            entry.again = false
            await new UpgradeRun(this.deps, entry).execute()
          } while (entry.again && (await this.deps.isProjectOpen(entry.request.project)))
        } finally {
          this.entries.delete(key)
        }
      }),
    }
    this.entries.set(key, entry)
    return entry.done
  }

  /** Restarts the upgrades of a loaded project; clips whose provider is not connected wait for the user. */
  async resume(project: Project): Promise<void> {
    const connected = new Map<CloudProviderId, boolean>()
    const waiting = new Map<CloudProviderId, string[]>()
    const runs = new Array<Promise<void>>()
    for (const clip of project.getClips()) {
      const media = clip.meetingMedia
      if (!media || !needsUpgrade(media)) continue
      let ready = true
      for (const provider of new Set(media.sessions.map((session) => session.provider))) {
        if (!connected.has(provider)) connected.set(provider, await this.deps.isConnected(provider))
        if (!connected.get(provider)) {
          waiting.set(provider, [...(waiting.get(provider) ?? []), media.username])
          ready = false
        }
      }
      if (ready) runs.push(this.schedule(project, clip))
    }
    for (const [provider, names] of waiting) {
      NotificationsController.showLongDurationMessage(
        `Connect ${CLOUD_PROVIDER_NAMES[provider]} to finish upgrading ${formatNames(names)}.`,
      )
    }
    await Promise.all(runs)
  }
}

class UpgradeRun {
  private readonly project: Project
  private readonly clip: Clip
  private readonly media: MeetingMedia
  private patch: HighQualityPatchClient | null = null
  private paused = false
  private resumed = Promise.withResolvers<void>()
  /** The video session being remuxed, which a pause waits for. */
  private videoWork: Promise<unknown> | null = null

  constructor(
    private readonly deps: UpgradeDependencies,
    private readonly entry: RunEntry,
  ) {
    this.project = entry.request.project
    this.clip = entry.request.clip
    this.media = entry.request.clip.meetingMedia!
  }

  async execute(): Promise<void> {
    if (!this.media || !needsUpgrade(this.media)) return
    for (const provider of new Set(this.media.sessions.map((session) => session.provider))) {
      if (!(await this.deps.isConnected(provider))) {
        NotificationsController.showLongDurationMessage(
          `Connect ${CLOUD_PROVIDER_NAMES[provider]} to finish upgrading ${this.media.username}.`,
        )
        return
      }
    }
    const unregister = registerUpgrade(this)
    try {
      const listings = await this.waitUntilFinal()
      if (!listings) return
      const sessions = new Array<SessionFiles>()
      for (const [index, session] of this.media.sessions.entries()) {
        const files = listings[index]
        sessions.push({ session, files, manifest: files ? await this.readManifest(session, files) : null })
      }
      await this.handleMissingFolders(sessions)
      if (this.media.audio == 'pending') {
        await this.upgradeAudio(sessions)
      }
      if ((this.media.video == 'pending' || this.media.video == 'replacing') && !this.clip.videoRecordingInProgress) {
        await this.upgradeVideo(sessions)
      }
    } catch (error) {
      NotificationsController.showErrorMessage(
        `Could not upgrade ${this.media.username}'s recording: ${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      unregister()
      this.patch?.close()
    }
  }

  async pause(): Promise<void> {
    if (!this.paused) {
      this.paused = true
      this.resumed = Promise.withResolvers<void>()
    }
    await Promise.all([this.patch?.pause(), this.videoWork])
  }

  resume(): void {
    if (!this.paused) return
    this.paused = false
    this.patch?.resume()
    this.resumed.resolve()
  }

  /** Holds new work, not listings, while upgrades are paused. */
  private async gate() {
    while (this.paused) await this.resumed.promise
  }

  /** Each session's final listing, or null when the project closed first. */
  private async waitUntilFinal(): Promise<Array<CloudFile[] | null> | null> {
    const sessions = this.media.sessions
    const states = sessions.map(() => ({
      final: false,
      files: null as CloudFile[] | null,
      signature: '',
      changedAt: this.deps.now(),
    }))
    const live = this.entry.request.liveSessions
    for (;;) {
      if (!(await this.deps.isProjectOpen(this.project))) return null
      for (const [index, session] of sessions.entries()) {
        const state = states[index]
        if (state.final) continue
        let files: CloudFile[] | null
        try {
          files = await this.deps.getStorage(session.provider).listFiles(session.folder)
        } catch (error) {
          // Retried at the next poll; other errors end the run.
          if (!(error instanceof CloudUnavailableError)) throw error
          logger.log(`Listing ${session.folder} failed: ${error.message}`)
          continue
        }
        const signature = (files ?? [])
          .map((file) => `${file.name}:${file.size}`)
          .sort()
          .join('/')
        if (signature != state.signature) {
          state.signature = signature
          state.changedAt = this.deps.now()
        }
        state.files = files
        const sessionId = session.sessionId
        state.final =
          files?.some((file) => file.name == MANIFEST_NAME) == true ||
          live?.isFinal(sessionId) == true ||
          (live?.isLive(sessionId) != true && this.deps.now() - state.changedAt >= HQ_STALE_UPLOAD_MS)
      }
      if (states.every((state) => state.final)) return states.map((state) => state.files)
      await this.sleepUnlessWoken(HQ_POLL_INTERVAL_MS)
    }
  }

  private async sleepUnlessWoken(milliseconds: number) {
    const woken = Promise.withResolvers<void>()
    this.entry.wake = () => {
      // The user asked for the run that is waiting; it needs no second run.
      this.entry.again = false
      woken.resolve()
    }
    try {
      await Promise.race([this.deps.sleep(milliseconds), woken.promise])
    } finally {
      this.entry.wake = () => {}
    }
  }

  private async readManifest(session: MeetingMediaSession, files: readonly CloudFile[]): Promise<Manifest | null> {
    const listed = files.find((file) => file.name == MANIFEST_NAME)
    if (!listed || listed.size > MAX_MANIFEST_BYTES) return null
    const stream = await this.deps.getStorage(session.provider).readFile(`${session.folder}/${MANIFEST_NAME}`)
    if (!stream) return null
    try {
      return parseManifest(JSON.parse(await new Response(stream).text()), session.sessionId)
    } catch (error) {
      logger.log(`Ignoring the unreadable manifest of ${session.folder}: ${String(error)}`)
      return null
    }
  }

  private async handleMissingFolders(sessions: readonly SessionFiles[]) {
    const missing = sessions.filter((entry) => !entry.files)
    if (missing.length == 0) return
    for (const provider of new Set(missing.map((entry) => entry.session.provider))) {
      NotificationsController.showLongDurationMessage(
        `${this.media.username}'s high-quality media is no longer in ${CLOUD_PROVIDER_NAMES[provider]}; kept the recording as is.`,
      )
    }
    // A replacement that already deleted the call video can only be finished from the cloud copy.
    if (this.media.video == 'pending') this.media.video = 'kept'
    if (missing.length == sessions.length) this.media.audio = 'done'
    await ProjectManager.saveClip(this.clip)
  }

  /** Patches every session's audio into the clip file once, saving where it landed, then marks the audio done. */
  private async upgradeAudio(sessions: readonly SessionFiles[]) {
    let hqSamples = 0
    for (const entry of sessions) {
      const { session } = entry
      if (session.runs) {
        // Patched by a run that was cut short; mixing again would sharpen the crossfades at its run edges.
        hqSamples += session.runs.reduce((total, run) => total + run.length, 0)
        continue
      }
      if (!entry.files) continue
      await this.gate()
      const result = await this.patchSession(entry)
      session.runs = result.runs
      hqSamples += result.stats.hqSamples
      await ProjectManager.saveClip(this.clip)
    }
    this.media.audio = 'done'
    await ProjectManager.saveClip(this.clip)
    const length = this.clip.summary.length
    NotificationsController.showLongDurationMessage(
      hqSamples > 0
        ? `Upgraded ${this.media.username}'s recording to high-quality audio (${Math.round((100 * hqSamples) / Math.max(length, 1))}% of the recording).`
        : `No usable high-quality audio arrived from ${this.media.username}; kept the call audio.`,
    )
  }

  private async patchClient(): Promise<HighQualityPatchClient> {
    if (!this.patch) {
      this.patch = new HighQualityPatchClient(await this.deps.openPatchPort())
      if (this.paused) void this.patch.pause()
    }
    return this.patch
  }

  private async patchSession(entry: SessionFiles): Promise<{ stats: PatchStats; runs: Run[] }> {
    const { session } = entry
    const client = await this.patchClient()
    const key = `upgrade:${session.sessionId}`
    // `outstanding` estimates posted − patched from the last progress plus what was posted since.
    const flow = { outstanding: 0, postedSinceProgress: 0, ended: false, changed: Promise.withResolvers<void>() }
    const notify = () => {
      flow.changed.resolve()
      flow.changed = Promise.withResolvers<void>()
    }
    const finished = Promise.withResolvers<{ stats: PatchStats; runs: Run[] }>()
    // Observed below; a failure while posting must not count as unhandled.
    finished.promise.catch(() => {})
    client.open(
      {
        key,
        clip: this.clip,
        dirname: this.project.directoryName,
        priorFrame: session.priorFrame,
        segmentStart: session.segmentStart,
        segmentEnd: session.segmentEnd ?? this.clip.summary.length,
      },
      {
        onProgress: ({ heldFrames }) => {
          flow.outstanding = heldFrames
          flow.postedSinceProgress = 0
          notify()
        },
        onDone: (result) => {
          flow.ended = true
          notify()
          finished.resolve(result)
        },
        onFailed: ({ name, message }) => {
          flow.ended = true
          notify()
          finished.reject(Object.assign(new Error(message), { name }))
        },
      },
    )
    try {
      let end = 0
      for (const chunk of this.audioChunks(entry)) {
        if (flow.ended) break
        const audio = await this.downloadAudioChunk(entry, chunk)
        if (!audio) continue
        end = Math.max(end, audio.firstSeq + audio.frameCount)
        for (let offset = 0; offset < audio.frameCount && !flow.ended; offset += FRAMES_PER_POST) {
          const count = Math.min(FRAMES_PER_POST, audio.frameCount - offset)
          // Should the aligner still hold more than the cap after everything posted so far, the next batch goes out
          // regardless: it needs later frames to make progress.
          while (!flow.ended && flow.outstanding + count > HQ_MAX_INFLIGHT_FRAMES && flow.postedSinceProgress > 0) {
            await flow.changed.promise
          }
          await this.gate()
          if (flow.ended) break
          const start = HQ_AUDIO_CHUNK_HEADER_BYTES + offset * HQ_FRAME_BYTES
          client.frames(key, audio.firstSeq + offset, audio.bytes.slice(start, start + count * HQ_FRAME_BYTES).buffer)
          flow.outstanding += count
          flow.postedSinceProgress += count
        }
      }
      if (!flow.ended) client.finish(key, entry.manifest?.frameCount ?? end)
    } catch (error) {
      client.abort(key)
      throw error
    }
    return finished.promise
  }

  private audioChunks(entry: SessionFiles): AudioChunkRef[] {
    if (entry.manifest) return [...entry.manifest.audio]
    return entry
      .files!.filter((file) => AUDIO_CHUNK_NAME.test(file.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((file) => ({ name: file.name, size: file.size, contentHash: null, firstSeq: null, frameCount: null }))
  }

  /** The chunk's bytes when they are what the manifest and listing describe; otherwise null, skipping the chunk. */
  private async downloadAudioChunk(
    entry: SessionFiles,
    chunk: AudioChunkRef,
  ): Promise<{ bytes: Uint8Array<ArrayBuffer>; firstSeq: number; frameCount: number } | null> {
    const { session } = entry
    const skip = (reason: string) => {
      logger.log(`Skipping ${session.folder}/${chunk.name}: ${reason}`)
      return null
    }
    const listed = entry.files!.find((file) => file.name == chunk.name)
    if (!listed) return skip('missing')
    if (listed.size != chunk.size) return skip(`listed with ${listed.size} bytes, expected ${chunk.size}`)
    const stream = await this.deps.getStorage(session.provider).readFile(`${session.folder}/${chunk.name}`)
    if (!stream) return skip('missing')
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer())
    if (bytes.length != chunk.size) return skip(`downloaded ${bytes.length} bytes, expected ${chunk.size}`)
    const expectedHash = chunk.contentHash ?? listed.contentHash
    if (expectedHash && (await contentHash(bytes)) != expectedHash) return skip('content hash mismatch')
    if (bytes.length < HQ_AUDIO_CHUNK_HEADER_BYTES) return skip('no header')
    const view = new DataView(bytes.buffer)
    const magic = String.fromCharCode(...bytes.subarray(0, 4))
    const firstSeq = view.getUint32(8, true)
    const frameCount = view.getUint32(12, true)
    if (magic != CHUNK_MAGIC || view.getUint16(4, true) != 1 || view.getUint16(6, true) != 0) return skip('bad header')
    if (
      frameCount < 1 ||
      frameCount > HQ_AUDIO_CHUNK_FRAMES ||
      firstSeq + frameCount - 1 > HQ_MAX_FRAME_SEQ ||
      bytes.length != HQ_AUDIO_CHUNK_HEADER_BYTES + frameCount * HQ_FRAME_BYTES
    ) {
      return skip('bad frame range')
    }
    if ((chunk.firstSeq ?? firstSeq) != firstSeq || (chunk.frameCount ?? frameCount) != frameCount) {
      return skip('header disagrees with the manifest')
    }
    return { bytes, firstSeq, frameCount }
  }

  private async upgradeVideo(sessions: SessionFiles[]) {
    const { username } = this.media
    const reason = await this.videoUnusableReason(sessions)
    if (reason) {
      logger.log(`Keeping ${username}'s call video: ${reason}`)
      if (this.media.video == 'pending') {
        this.media.video = 'kept'
        await ProjectManager.saveClip(this.clip)
      } else {
        this.reportVideoFailure(sessions[0].session, reason)
      }
      return
    }

    const dirname = this.project.directoryName
    const oldSegments = this.clip.videoSegments
    const videoName = (index: number) => `${this.clip.filename}_video_${index}`
    const uploaded = sessions.reduce((total, entry) => total + entry.manifest!.video!.size, 0)
    let current = 0
    for (const segment of oldSegments) {
      current += await FileSystemUtils.getExistingFile(dirname, videoName(segment.index)).then(
        (file) => file.size,
        () => 0,
      )
    }
    const needed = uploaded - current + HQ_STORAGE_HEADROOM_BYTES
    const free = await this.deps.freeStorageBytes()
    if (free != null && free < needed) {
      NotificationsController.showLongDurationMessage(
        `Not enough browser storage to replace ${username}'s video; free ${humanizeBytes(needed)} and use Finish high-quality upgrade.`,
      )
      return
    }

    await this.gate()
    if (this.media.video == 'pending') {
      this.media.video = 'replacing'
      this.clip.videoSegments = []
      await ProjectManager.saveClip(this.clip)
      redraw()
      for (const segment of oldSegments) await FileSystemUtils.deleteFile(dirname, videoName(segment.index))
    }

    const written = new Array<string>()
    const segments = new Array<VideoSegment>()
    let failed: SessionFiles = sessions[0]
    try {
      for (const [index, entry] of sessions.entries()) {
        failed = entry
        await this.gate()
        const filename = videoName(1 + index)
        written.push(filename)
        const work = this.deps.remux({
          dirname,
          filename,
          size: entry.manifest!.video!.size,
          readChunk: this.chunkReader(entry),
          runs: entry.session.runs!,
        })
        this.videoWork = work.catch(() => {})
        let segment: VideoSegment
        try {
          segment = await work
        } finally {
          this.videoWork = null
        }
        const clamped = clampSegment(
          segment,
          entry.session.segmentStart,
          entry.session.segmentEnd ?? this.clip.summary.length,
          this.project.sampleRate,
        )
        if (clamped) segments.push({ ...clamped, index: 1 + index, trackNumber: 1, mimeType: 'video/mp4' })
        else await FileSystemUtils.deleteFile(dirname, filename)
      }
    } catch (error) {
      await Promise.all(written.map((filename) => FileSystemUtils.deleteFile(dirname, filename).catch(() => {})))
      this.reportVideoFailure(failed.session, error instanceof Error ? error.message : String(error))
      return
    }
    this.clip.videoSegments = segments
    this.clip.videoLength = Math.max(0, ...segments.map((segment) => segment.startSample + segment.length))
    this.media.video = 'done'
    await ProjectManager.saveClip(this.clip)
    redraw()
    NotificationsController.showLongDurationMessage(`Replaced ${username}'s video with the high-quality recording.`)
  }

  private reportVideoFailure(session: MeetingMediaSession, message: string) {
    NotificationsController.showErrorMessage(
      `Could not finish ${this.media.username}'s high-quality video: ${message}. It is safe in ${CLOUD_PROVIDER_NAMES[session.provider]} under ${session.folder}; use Finish high-quality upgrade to retry.`,
    )
  }

  /** Why the uploads can't replace the call video, or null when every chunk is there with its manifest hash. */
  private async videoUnusableReason(sessions: readonly SessionFiles[]): Promise<string | null> {
    for (const { session, files, manifest } of sessions) {
      if (!files || !manifest) return `${session.folder} has no manifest`
      // Saved when this session's audio was patched; an older run's patch left no alignment to map the video with.
      if (!session.runs?.length) return `${session.folder} has no aligned audio`
      if (!manifest.complete || !manifest.video) return `${session.folder} has no complete video`
      for (const chunk of manifest.video.chunks) {
        const listed = files.find((file) => file.name == chunk.name)
        if (!listed || listed.size != chunk.size) return `${session.folder}/${chunk.name} is missing`
        if (listed.contentHash != null) {
          if (listed.contentHash != chunk.contentHash) return `${session.folder}/${chunk.name} has changed`
          continue
        }
        // The provider lists no hashes (S3): the bytes are hashed once, and discarded, before anything is deleted.
        await this.gate()
        const stream = await this.deps.getStorage(session.provider).readFile(`${session.folder}/${chunk.name}`)
        if (!stream) return `${session.folder}/${chunk.name} is missing`
        const hasher = new ContentHasher()
        let size = 0
        const reader = stream.getReader()
        for (let piece = await reader.read(); !piece.done; piece = await reader.read()) {
          size += piece.value.length
          await hasher.update(piece.value)
        }
        if (size != chunk.size || (await hasher.digest()) != chunk.contentHash) {
          return `${session.folder}/${chunk.name} has changed`
        }
      }
    }
    return null
  }

  /** Reads verified video chunks, keeping the last two, as the remux reads mostly forward. */
  private chunkReader(entry: SessionFiles): (index: number) => Promise<Uint8Array> {
    const { session } = entry
    const chunks = entry.manifest!.video!.chunks
    const cache = new Array<{ index: number; bytes: Uint8Array }>()
    return async (index) => {
      const cached = cache.find((item) => item.index == index)
      if (cached) return cached.bytes
      const chunk = chunks[index]
      if (!chunk) throw new Error(`the video has no chunk ${index + 1}`)
      const stream = await this.deps.getStorage(session.provider).readFile(`${session.folder}/${chunk.name}`)
      if (!stream) throw new Error(`${chunk.name} is missing`)
      const bytes = new Uint8Array(await new Response(stream).arrayBuffer())
      // Upload links stay valid after the check (S3), so a chunk could have been replaced since.
      if (bytes.length != chunk.size || (await contentHash(bytes)) != chunk.contentHash) {
        throw new Error(`${chunk.name} changed during the upgrade`)
      }
      cache.push({ index, bytes })
      if (cache.length > 2) cache.shift()
      return bytes
    }
  }
}

/** Trims `segment` to `[start, end)` on the clip's timeline; null when nothing remains. */
export function clampSegment(
  segment: VideoSegment,
  start: number,
  end: number,
  sampleRate: number,
): VideoSegment | null {
  const trimmed = Math.max(0, start - segment.startSample)
  const startSample = segment.startSample + trimmed
  const length = Math.min(segment.startSample + segment.length, end) - startSample
  if (length <= 0) return null
  return { ...segment, startSample, length, mediaStartSeconds: segment.mediaStartSeconds + trimmed / sampleRate }
}

/** The manifest the guest uploaded last, or null when it isn't one for this session. */
export function parseManifest(value: unknown, sessionId: string): Manifest | null {
  if (
    !isRecord(value) ||
    value.format != 'soundetch-meeting-media' ||
    value.version != 1 ||
    value.sessionId != sessionId ||
    !isCount(value.frameCount) ||
    typeof value.complete != 'boolean' ||
    !Array.isArray(value.audio)
  ) {
    return null
  }
  const maxAudioSize = HQ_AUDIO_CHUNK_HEADER_BYTES + HQ_AUDIO_CHUNK_FRAMES * HQ_FRAME_BYTES
  const audio = new Array<ManifestAudioChunk>()
  for (const chunk of value.audio as unknown[]) {
    const file = parseManifestFile(chunk, AUDIO_CHUNK_NAME, maxAudioSize)
    if (!file || !isRecord(chunk) || !isCount(chunk.firstSeq) || !isCount(chunk.frameCount)) return null
    audio.push({ ...file, firstSeq: chunk.firstSeq, frameCount: chunk.frameCount })
  }
  let video: Manifest['video'] = null
  if (value.video != null) {
    const { codec, size, chunks } = isRecord(value.video) ? value.video : {}
    if (typeof codec != 'string' || !isCount(size) || !Array.isArray(chunks) || chunks.length == 0) return null
    const files = new Array<ManifestFile>()
    for (const chunk of chunks as unknown[]) {
      const file = parseManifestFile(chunk, VIDEO_CHUNK_NAME, HQ_VIDEO_CHUNK_BYTES)
      if (!file) return null
      files.push(file)
    }
    // The remux addresses bytes by fixed chunk size, so every chunk but the last must be full.
    const full = files.slice(0, -1).every((file) => file.size == HQ_VIDEO_CHUNK_BYTES)
    if (!full || files.reduce((sum, file) => sum + file.size, 0) != size) return null
    video = { codec, size, chunks: files }
  }
  return { frameCount: value.frameCount, audio, video, complete: value.complete }
}

function parseManifestFile(value: unknown, pattern: RegExp, maxSize: number): ManifestFile | null {
  if (!isRecord(value)) return null
  const { name, size, contentHash } = value
  if (typeof name != 'string' || !pattern.test(name) || typeof contentHash != 'string') return null
  if (typeof size != 'number' || !Number.isInteger(size) || size <= 0 || size > maxSize) return null
  return { name, size, contentHash }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value == 'object' && value != null
}

/** Frame counts and seqs; video sizes stay far below this too. */
function isCount(value: unknown): value is number {
  return typeof value == 'number' && Number.isSafeInteger(value) && value >= 0
}

function redraw() {
  // The track list registers itself on window; this module must not import the UI.
  const host = globalThis as typeof globalThis & { trackListController?: { draw?(): void } }
  host.trackListController?.draw?.()
}

function formatNames(names: readonly string[]): string {
  return new Intl.ListFormat(undefined, { type: 'conjunction' }).format(names)
}

const defaultDependencies: UpgradeDependencies = {
  getStorage: getCloudStorage,
  isConnected: isProviderConnected,
  // Both load on demand: the Recorder and mediabunny stay out of this lazy chunk until an upgrade needs them.
  openPatchPort: async () => (await import('../recording/Recorder')).Recorder.openHighQualityPatchPort(),
  remux: async (request) => (await import('./MeetingMediaRemux')).remuxSessionVideo(request),
  isProjectOpen: async (project) => (await ProjectManager.getActiveProject()) === project,
  freeStorageBytes: async () => {
    const estimate = await globalThis.navigator?.storage?.estimate?.()
    return estimate?.quota != null && estimate.usage != null ? estimate.quota - estimate.usage : null
  },
  now: () => Date.now(),
  sleep: (milliseconds) => {
    const { promise, resolve } = Promise.withResolvers<void>()
    setTimeout(resolve, milliseconds)
    return promise
  },
}

let upgrades: MeetingMediaUpgrades | null = null

export function scheduleUpgrade(project: Project, clip: Clip, options?: { liveSessions?: LiveCloudSessions }): void {
  upgrades ??= new MeetingMediaUpgrades(defaultDependencies)
  void upgrades.schedule(project, clip, options)
}

export function resumeUpgrades(project: Project): void {
  upgrades ??= new MeetingMediaUpgrades(defaultDependencies)
  void upgrades.resume(project)
}
