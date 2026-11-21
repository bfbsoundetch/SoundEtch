import { AudioControl, AudioState, type AudioControlListener } from '../audiocontext/AudioControl'
import {
  CLOUD_PROVIDER_NAMES,
  getCloudStorage,
  getSelectedProvider,
  isProviderConnected,
} from '../backup/CloudProviders'
import { CloudAuthorizationError, type CloudProviderId, type CloudStorage } from '../backup/CloudStorage'
import { Logger } from '../global/Logger'
import type { Clip } from '../project/Clip'
import type { MeetingMediaSession } from '../project/MeetingMedia'
import type { Project } from '../project/Project'
import { ProjectArchive } from '../project/ProjectArchive'
import { ProjectManager } from '../project/ProjectManager'
import { RecordingSessions, type RecordingSession } from '../recording/RecordingSessions'
import { registerUpgrade } from '../recording/UnsettledRecordings'
import { NotificationsController } from '../ui/NotificationsController'
import {
  HQ_AUDIO_CHUNK_FRAMES,
  HQ_AUDIO_CHUNK_HEADER_BYTES,
  HQ_CLOUD_ROOT,
  HQ_FRAME_BYTES,
  HQ_MAX_FRAME_SEQ,
  HQ_VIDEO_CHUNK_BYTES,
} from './HighQualityAudioFormat'
import { HighQualityPatchClient, type PatchStats } from './HighQualityPatchClient'
import type { LiveCloudSessions } from './MeetingMediaUpgrade'
import type { HighQualityMessage, RemoteMediaClient3, State } from './RemoteMediaClient3'

/** An offer nobody answers within this time counts as declined; older builds never answer. */
export const HQ_OFFER_TIMEOUT_MS = 10000
/** Upload links kept issued per kind (audio, video). Dropbox links take one upload each; S3 links are free. */
export const HQ_LINK_POOL: Readonly<Record<CloudProviderId, number>> = { dropbox: 3, s3: 20 }
/** Dropbox caps temporary upload links at 4 h; presigned S3 URLs last a day so a long meeting's links keep working. */
export const HQ_LINK_DURATION_SECONDS: Readonly<Record<CloudProviderId, number>> = { dropbox: 14400, s3: 86400 }

const MAX_CONCURRENT_LINK_REQUESTS = 4
const LINK_RETRY_MS = 30000
const REOFFER_DELAY_MS = 1000
/** How far beyond the highest issued ordinal a guest may ask for links, so it cannot make us issue unbounded links. */
const MAX_LINK_ORDINAL_AHEAD = 200
const MAX_LINK_REQUEST_NAMES = 1000
const MAX_CONTENT_HASH_LENGTH = 128
const MAX_LOGGED_MESSAGE_LENGTH = 500
const CHUNK_NAME = /^(?:(audio)-(\d{5})\.pcm|(video)-(\d{5})\.part|manifest\.json)$/
const MAX_AUDIO_CHUNK_BYTES = HQ_AUDIO_CHUNK_HEADER_BYTES + HQ_AUDIO_CHUNK_FRAMES * HQ_FRAME_BYTES
const MAX_MANIFEST_BYTES = 1024 * 1024

type PatchClient = Pick<
  HighQualityPatchClient,
  'open' | 'frames' | 'segmentEnd' | 'finish' | 'abort' | 'pause' | 'resume' | 'close'
>

/** The parts of `RemoteMediaClient3` the receiver uses, so tests can fake it. */
export type HighQualityReceiverClient = Pick<
  RemoteMediaClient3,
  'addStateListener' | 'addHighQualityListener' | 'sendHighQuality'
>

export interface HighQualityMediaReceiverDeps {
  createPatchClient(port: MessagePort): PatchClient
  getSelectedProvider(): Promise<CloudProviderId>
  isProviderConnected(provider: CloudProviderId): Promise<boolean>
  getCloudStorage(provider: CloudProviderId): Pick<CloudStorage, 'createUploadLink'>
  /** The project being recorded into. */
  getProject(): Promise<Project>
  saveClip(clip: Clip): Promise<void>
  scheduleUpgrade(project: Project, clip: Clip, options: { liveSessions: LiveCloudSessions }): Promise<void>
}

const defaultDeps: HighQualityMediaReceiverDeps = {
  createPatchClient: (port) => new HighQualityPatchClient(port),
  getSelectedProvider,
  isProviderConnected,
  getCloudStorage,
  getProject: () => ProjectManager.getActiveProject(),
  saveClip: (clip) => ProjectManager.saveClip(clip),
  // Lazy: the upgrade code (mediabunny remuxing) loads only once a recording with cloud sessions ends.
  scheduleUpgrade: async (project, clip, options) =>
    (await import('./MeetingMediaUpgrade')).scheduleUpgrade(project, clip, options),
}

type ChunkKind = 'audio' | 'video' | 'manifest'

interface Segment {
  readonly start: number
  end: number | null
}

interface Offer {
  readonly sessionId: string
  readonly peerId: string
  readonly clip: Clip
  readonly provider: CloudProviderId | null
  readonly segmentIndex: number
  readonly timer: ReturnType<typeof setTimeout>
}

interface CloudIncoming {
  readonly provider: CloudProviderId
  readonly folder: string
  readonly media: MeetingMediaSession
  /** `hqComplete` or `hqFailed` arrived. */
  final: boolean
  readonly highest: { audio: number; video: number }
  /** Names whose links are being issued now. */
  readonly requested: Set<string>
  /** Names whose links failed to issue; retried every LINK_RETRY_MS. */
  readonly retry: Set<string>
  readonly uploaded: Set<string>
}

interface Incoming {
  readonly sessionId: string
  readonly peerId: string
  readonly username: string
  readonly clip: Clip
  readonly segmentIndex: number
  readonly priorFrame: number
  /** The guest ended its side, failed, or left; it is free for another offer. */
  ended: boolean
  readonly received: Set<number>
  maxSeq: number
  frameCount: number | null
  sentCount: number | null
  /** Peer sessions only: where the in-place patch stands. */
  patch: 'open' | 'finishing' | 'done' | 'failed' | 'aborted' | null
  stats: PatchStats | null
  readonly cloud: CloudIncoming | null
}

interface Recording {
  readonly session: RecordingSession
  readonly startedAt: Date
  ready: Promise<void>
  /** Set once `ready` resolves when the active project is the one recorded into; cloud sessions need its title. */
  project: Project | null
  /** Member peer id → its mono recorded clip. */
  readonly peerClips: ReadonlyMap<string, Clip>
  readonly usernames: ReadonlyMap<string, string>
  readonly segments: Segment[]
  readonly sessions: Map<string, Incoming>
  readonly offers: Map<string, Offer>
  /** Peers that declined as busy during the open segment. */
  readonly busy: Set<string>
  readonly reofferTimers: Set<ReturnType<typeof setTimeout>>
  readonly patch: PatchClient
  readonly unregisterUpgrade: () => void
  readonly failedClips: Set<Clip>
  readonly notifiedClips: Set<Clip>
  stopped: boolean
  closed: boolean
}

/**
 * The recorder's side of meeting high-quality media: offers each recorded member a session, patches peer-transport
 * audio into the member's clip while it records, and issues upload links for the cloud transport, whose media is
 * applied after the recording by `MeetingMediaUpgrade`.
 */
export class HighQualityMediaReceiver {
  private static readonly logger = new Logger('hq-receiver')

  private readonly deps: HighQualityMediaReceiverDeps
  private readonly recordings = new Set<Recording>()
  private readonly incoming = new Map<string, { recording: Recording; incoming: Incoming }>()
  private readonly abortController = new AbortController()
  private readonly unsubscribeSessions: () => void
  private members = new Map<string, string>()
  private current: Recording | null = null
  private audioState = AudioState.STOPPED
  private disposed = false
  private linkRequestsRunning = 0
  private readonly linkRequestQueue = new Array<() => void>()
  private linkRetryTimer: ReturnType<typeof setTimeout> | null = null
  private readonly authorizationReported = new Set<CloudProviderId>()

  private readonly audioControlListener: AudioControlListener = (state: AudioState) => this.onAudioState(state)

  private readonly liveSessions: LiveCloudSessions = {
    isLive: (sessionId) => {
      const entry = this.incoming.get(sessionId)?.incoming
      return !this.disposed && entry?.cloud != null && !entry.cloud.final && this.members.has(entry.peerId)
    },
    isFinal: (sessionId) => this.incoming.get(sessionId)?.incoming.cloud?.final ?? false,
  }

  constructor(
    private readonly client: HighQualityReceiverClient,
    deps: Partial<HighQualityMediaReceiverDeps> = {},
  ) {
    this.deps = { ...defaultDeps, ...deps }
    this.unsubscribeSessions = RecordingSessions.addListener((session) => this.onPublish(session))
    // The client has no way to remove listeners; `disposed` silences them instead.
    client.addHighQualityListener((peerId, message) => {
      if (!this.disposed) this.onMessage(peerId, message)
    })
    client.addStateListener((state) => {
      if (!this.disposed) this.onState(state)
    })
    AudioControl.addAudioControlListener(this.audioControlListener)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unsubscribeSessions()
    const listeners = AudioControl.audioControlListeners
    const index = listeners.indexOf(this.audioControlListener)
    if (index >= 0) listeners.splice(index, 1)
    this.abortController.abort()
    clearTimeout(this.linkRetryTimer ?? undefined)
    this.linkRetryTimer = null
    for (const recording of this.recordings) {
      this.cancelOffers(recording, false)
      recording.reofferTimers.forEach((timer) => clearTimeout(timer))
      recording.reofferTimers.clear()
      for (const incoming of recording.sessions.values()) {
        if (incoming.patch == 'open' || incoming.patch == 'finishing') {
          // Aborting keeps what was already patched.
          recording.patch.abort(incoming.sessionId)
          incoming.patch = 'aborted'
        }
      }
      this.closeRecording(recording)
    }
    this.current = null
  }

  private onState(state: State): void {
    const previous = this.members
    this.members = new Map(state.members.map((member) => [member.peerId, member.username]))
    for (const peerId of previous.keys()) {
      if (!this.members.has(peerId)) this.onDeparture(peerId)
    }
  }

  private onAudioState(state: AudioState): void {
    this.audioState = state
    const recording = this.current
    if (!recording || recording.stopped) return
    if (state == AudioState.RECORDING_PAUSED) {
      void this.closeSegment(recording)
    } else if (state == AudioState.RECORDING) {
      if (openSegmentIndex(recording) == null) {
        recording.segments.push({ start: Math.max(...audioLengths(recording)), end: null })
        recording.busy.clear()
      }
      void this.offer(recording)
    }
  }

  private onPublish(session: RecordingSession): void {
    if (this.disposed) return
    const peerClips = new Map<string, Clip>()
    const usernames = new Map<string, string>()
    for (const [inputId, clip] of session.clipsByInputId) {
      const username = this.members.get(inputId)
      if (username != null && clip.getChannelCount() == 1) {
        peerClips.set(inputId, clip)
        usernames.set(inputId, username)
      }
    }
    if (peerClips.size == 0) return
    const patch = this.deps.createPatchClient(session.openPatchPort())
    const recording: Recording = {
      session,
      startedAt: new Date(),
      ready: Promise.resolve(),
      project: null,
      peerClips,
      usernames,
      segments: [{ start: 0, end: null }],
      sessions: new Map(),
      offers: new Map(),
      busy: new Set(),
      reofferTimers: new Set(),
      patch,
      unregisterUpgrade: registerUpgrade({ pause: () => patch.pause(), resume: () => patch.resume() }),
      failedClips: new Set(),
      notifiedClips: new Set(),
      stopped: false,
      closed: false,
    }
    recording.ready = this.deps.getProject().then(
      (project) => {
        recording.project = project.directoryName == session.dirname ? project : null
      },
      (error) => HighQualityMediaReceiver.logger.error(error),
    )
    this.recordings.add(recording)
    this.current = recording
    void session.finished.then(() => this.onFinished(recording))
    if (this.audioState == AudioState.RECORDING) void this.offer(recording)
  }

  private async offer(recording: Recording): Promise<void> {
    await recording.ready
    let cloud = false
    let provider: CloudProviderId | null = null
    if (recording.project) {
      try {
        provider = await this.deps.getSelectedProvider()
        cloud = await this.deps.isProviderConnected(provider)
      } catch (error) {
        HighQualityMediaReceiver.logger.error(error as Error)
      }
    }
    if (this.disposed || recording.stopped || this.current !== recording || this.audioState != AudioState.RECORDING) {
      return
    }
    const segmentIndex = openSegmentIndex(recording)
    if (segmentIndex == null) return
    for (const [peerId, clip] of recording.peerClips) {
      if (!this.members.has(peerId) || recording.busy.has(peerId) || this.hasLiveSession(recording, peerId)) continue
      const sessionId = crypto.randomUUID()
      const message = {
        type: 'hqOffer',
        sessionId,
        transport: cloud ? 'cloud' : 'peer',
        video: clip.videoRecordingInProgress,
      } as const
      if (!this.client.sendHighQuality(peerId, message)) continue
      const timer = setTimeout(() => {
        if (recording.offers.delete(sessionId)) {
          HighQualityMediaReceiver.logger.log(`${this.usernameOf(recording, peerId)} did not answer the offer`)
        }
      }, HQ_OFFER_TIMEOUT_MS)
      recording.offers.set(sessionId, {
        sessionId,
        peerId,
        clip,
        provider: cloud ? provider : null,
        segmentIndex,
        timer,
      })
    }
  }

  private hasLiveSession(recording: Recording, peerId: string): boolean {
    for (const offer of recording.offers.values()) {
      if (offer.peerId == peerId) return true
    }
    for (const incoming of recording.sessions.values()) {
      if (incoming.peerId == peerId && !incoming.ended) return true
    }
    return false
  }

  private onMessage(peerId: string, message: HighQualityMessage): void {
    const data = message as unknown as Record<string, unknown> | null
    if (typeof data != 'object' || data == null || typeof data.sessionId != 'string') return
    // Offers, cancels and links go from recorders to the members they record: this member's sender handles them.
    if (data.type == 'hqOffer' || data.type == 'hqCancel' || data.type == 'hqLinks') return
    const sessionId = data.sessionId
    if (data.type == 'hqAccept') return this.onAccept(peerId, sessionId)
    if (data.type == 'hqDecline') return this.onDecline(peerId, sessionId, data.reason)
    const entry = this.incoming.get(sessionId)
    if (!entry || entry.incoming.peerId != peerId) {
      HighQualityMediaReceiver.logger.debug(`Ignored ${String(data.type)} for an unknown session from ${peerId}`)
      return
    }
    const { recording, incoming } = entry
    switch (data.type) {
      case 'hqFrame':
        return this.onFrame(recording, incoming, data.seq, data.pcm)
      case 'hqEnd':
        return this.onEnd(recording, incoming, data.frameCount, data.sentCount)
      case 'hqFailed':
        return this.onGuestFailed(recording, incoming, data.message)
      case 'hqComplete':
        if (incoming.cloud && !incoming.cloud.final) {
          incoming.cloud.final = true
          incoming.ended = true
          this.scheduleReoffer(recording, peerId)
          this.wakeUpgrade(recording, incoming.clip)
        }
        return
      case 'hqUploaded':
        return this.onUploaded(incoming, data.name, data.size, data.contentHash)
      case 'hqLinkRequest':
        return this.onLinkRequest(incoming, data.names)
    }
  }

  private onAccept(peerId: string, sessionId: string): void {
    for (const recording of this.recordings) {
      const offer = recording.offers.get(sessionId)
      if (!offer) continue
      if (offer.peerId != peerId) return
      clearTimeout(offer.timer)
      recording.offers.delete(sessionId)
      if (recording.stopped || recording.segments[offer.segmentIndex].end != null) {
        this.client.sendHighQuality(peerId, { type: 'hqCancel', sessionId })
        return
      }
      this.startSession(recording, offer)
      return
    }
    if (!this.incoming.has(sessionId)) {
      // A late accept of an offer that timed out: the guest would otherwise send to nobody.
      this.client.sendHighQuality(peerId, { type: 'hqCancel', sessionId })
    }
  }

  private onDecline(peerId: string, sessionId: string, reason: unknown): void {
    for (const recording of this.recordings) {
      const offer = recording.offers.get(sessionId)
      if (!offer || offer.peerId != peerId) continue
      clearTimeout(offer.timer)
      recording.offers.delete(sessionId)
      if (reason == 'busy') recording.busy.add(peerId)
      HighQualityMediaReceiver.logger.log(
        `${this.usernameOf(recording, peerId)} declined high-quality media (${String(reason).slice(0, 40)})`,
      )
      return
    }
  }

  private startSession(recording: Recording, offer: Offer): void {
    const { sessionId, peerId, clip, segmentIndex } = offer
    const username = this.usernameOf(recording, peerId)
    const priorFrame = clip.summary.length
    const segment = recording.segments[segmentIndex]
    let cloud: CloudIncoming | null = null
    if (offer.provider && recording.project) {
      const folder =
        `${HQ_CLOUD_ROOT}/${safeName(recording.project.title, 60)} ${formatStartedAt(recording.startedAt)}` +
        `/${safeName(username, 40)} ${sessionId.slice(0, 8)}`
      const media: MeetingMediaSession = {
        sessionId,
        provider: offer.provider,
        folder,
        priorFrame,
        segmentStart: segment.start,
        segmentEnd: segment.end,
      }
      cloud = {
        provider: offer.provider,
        folder,
        media,
        final: false,
        highest: { audio: 0, video: 0 },
        requested: new Set(),
        retry: new Set(),
        uploaded: new Set(),
      }
    }
    const incoming: Incoming = {
      sessionId,
      peerId,
      username,
      clip,
      segmentIndex,
      priorFrame,
      ended: false,
      received: new Set(),
      maxSeq: -1,
      frameCount: null,
      sentCount: null,
      patch: cloud ? null : 'open',
      stats: null,
      cloud,
    }
    recording.sessions.set(sessionId, incoming)
    this.incoming.set(sessionId, { recording, incoming })
    if (!cloud) {
      recording.patch.open(
        {
          key: sessionId,
          clip,
          dirname: recording.session.dirname,
          priorFrame,
          segmentStart: segment.start,
          segmentEnd: null,
        },
        {
          onDone: ({ stats }) => {
            if (incoming.patch == 'aborted') return
            incoming.patch = 'done'
            incoming.stats = stats
            this.onPatchSettled(recording, clip)
          },
          onFailed: ({ message }) => {
            if (incoming.patch == 'aborted') return
            incoming.patch = 'failed'
            if (!this.disposed && !recording.failedClips.has(clip)) {
              NotificationsController.showErrorMessage(`Could not upgrade ${username}'s recording: ${message}`)
            }
            recording.failedClips.add(clip)
            this.onPatchSettled(recording, clip)
          },
        },
      )
      return
    }
    clip.meetingMedia ??= { username, sessions: [], audio: 'pending', video: 'pending' }
    clip.meetingMedia.sessions.push(cloud.media)
    clip.meetingMedia.audio = 'pending'
    void this.saveClip(clip)
    const pool = HQ_LINK_POOL[cloud.provider]
    const names = new Array<string>()
    for (let ordinal = 1; ordinal <= pool; ++ordinal) {
      names.push(chunkName('audio', ordinal), chunkName('video', ordinal))
    }
    names.push('manifest.json')
    void this.issueLinks(incoming, names)
  }

  private onFrame(recording: Recording, incoming: Incoming, seq: unknown, pcm: unknown): void {
    if (incoming.patch != 'open' || !isFrameCount(seq)) return
    const buffer = normalizePcm(pcm)
    if (!buffer || incoming.received.has(seq)) return
    incoming.received.add(seq)
    incoming.maxSeq = Math.max(incoming.maxSeq, seq)
    recording.patch.frames(incoming.sessionId, seq, buffer)
    if (incoming.sentCount != null && incoming.received.size >= incoming.sentCount) this.finishPeer(recording, incoming)
  }

  private onEnd(recording: Recording, incoming: Incoming, frameCount: unknown, sentCount: unknown): void {
    if (incoming.patch != 'open' || !isFrameCount(frameCount) || !isFrameCount(sentCount)) return
    incoming.frameCount = frameCount
    incoming.sentCount = sentCount
    incoming.ended = true
    this.scheduleReoffer(recording, incoming.peerId)
    if (incoming.received.size >= sentCount) this.finishPeer(recording, incoming)
  }

  private onGuestFailed(recording: Recording, incoming: Incoming, message: unknown): void {
    if (incoming.ended && (incoming.cloud?.final ?? true)) return
    HighQualityMediaReceiver.logger.log(
      `${incoming.username} stopped sending high-quality media: ${String(message).slice(0, MAX_LOGGED_MESSAGE_LENGTH)}`,
    )
    incoming.ended = true
    if (incoming.cloud) {
      incoming.cloud.final = true
      this.wakeUpgrade(recording, incoming.clip)
    } else this.finishPeer(recording, incoming)
    this.scheduleReoffer(recording, incoming.peerId)
  }

  private finishPeer(recording: Recording, incoming: Incoming): void {
    if (incoming.patch != 'open') return
    incoming.patch = 'finishing'
    recording.patch.finish(incoming.sessionId, Math.max(incoming.frameCount ?? 0, incoming.maxSeq + 1))
  }

  private onUploaded(incoming: Incoming, name: unknown, size: unknown, contentHash: unknown): void {
    const cloud = incoming.cloud
    if (!cloud || typeof name != 'string' || typeof contentHash != 'string') return
    if (contentHash.length == 0 || contentHash.length > MAX_CONTENT_HASH_LENGTH) return
    const parsed = parseChunkName(name)
    if (!parsed || !Number.isInteger(size) || (size as number) < 0 || (size as number) > maxChunkBytes(parsed.kind)) {
      return
    }
    if (parsed.kind != 'manifest' && parsed.ordinal > cloud.highest[parsed.kind]) return
    if (cloud.uploaded.has(name)) return
    cloud.uploaded.add(name)
    if (parsed.kind != 'manifest' && !cloud.final) {
      void this.issueLinks(incoming, [chunkName(parsed.kind, cloud.highest[parsed.kind] + 1)])
    }
  }

  private onLinkRequest(incoming: Incoming, names: unknown): void {
    const cloud = incoming.cloud
    if (!cloud || cloud.final || !Array.isArray(names) || names.length > MAX_LINK_REQUEST_NAMES) return
    const valid = names.filter((name): name is string => {
      const parsed = typeof name == 'string' ? parseChunkName(name) : null
      return (
        parsed != null &&
        (parsed.kind == 'manifest' || parsed.ordinal <= cloud.highest[parsed.kind] + MAX_LINK_ORDINAL_AHEAD)
      )
    })
    void this.issueLinks(incoming, valid)
  }

  private async issueLinks(incoming: Incoming, names: string[]): Promise<void> {
    const cloud = incoming.cloud!
    const pending = Array.from(new Set(names)).filter((name) => !cloud.requested.has(name))
    if (pending.length == 0 || this.disposed) return
    for (const name of pending) {
      cloud.requested.add(name)
      cloud.retry.delete(name)
      const parsed = parseChunkName(name)!
      if (parsed.kind != 'manifest') cloud.highest[parsed.kind] = Math.max(cloud.highest[parsed.kind], parsed.ordinal)
    }
    const storage = this.deps.getCloudStorage(cloud.provider)
    const signal = this.abortController.signal
    const results = await Promise.all(
      pending.map((name) =>
        this.limitLinkRequest(() =>
          storage.createUploadLink(`${cloud.folder}/${name}`, HQ_LINK_DURATION_SECONDS[cloud.provider], signal),
        ).then(
          (link) => ({ name, link, error: null }),
          (error: unknown) => ({ name, link: null, error }),
        ),
      ),
    )
    if (this.disposed) return
    const links = new Array<{ name: string; method: 'POST' | 'PUT'; url: string }>()
    let authorizationFailed = false
    for (const { name, link, error } of results) {
      cloud.requested.delete(name)
      if (link) {
        links.push({ name, method: link.method, url: link.url })
      } else {
        cloud.retry.add(name)
        if (error instanceof CloudAuthorizationError) authorizationFailed = true
        else HighQualityMediaReceiver.logger.error(error as Error)
      }
    }
    if (links.length > 0 && !cloud.final) {
      this.client.sendHighQuality(incoming.peerId, { type: 'hqLinks', sessionId: incoming.sessionId, links })
    }
    if (authorizationFailed) {
      this.reportAuthorizationFailure(cloud.provider)
    } else if (links.length > 0) {
      this.authorizationReported.delete(cloud.provider)
    }
    if (cloud.retry.size > 0) this.scheduleLinkRetry()
  }

  /** Guests keep spooling meanwhile, so one message per outage is enough. */
  private reportAuthorizationFailure(provider: CloudProviderId): void {
    if (this.authorizationReported.has(provider)) return
    this.authorizationReported.add(provider)
    const names = new Set<string>()
    for (const { incoming } of this.incoming.values()) {
      if (incoming.cloud?.provider == provider && incoming.cloud.retry.size > 0) names.add(incoming.username)
    }
    NotificationsController.showErrorMessage(
      `Reconnect ${CLOUD_PROVIDER_NAMES[provider]} to keep receiving high-quality media from ${listNames(names)}.`,
    )
  }

  private scheduleLinkRetry(): void {
    if (this.linkRetryTimer != null || this.disposed) return
    this.linkRetryTimer = setTimeout(() => {
      this.linkRetryTimer = null
      for (const { incoming } of this.incoming.values()) {
        const cloud = incoming.cloud
        if (!cloud || cloud.retry.size == 0) continue
        if (cloud.final) cloud.retry.clear()
        else void this.issueLinks(incoming, Array.from(cloud.retry))
      }
    }, LINK_RETRY_MS)
  }

  /** Runs `request` once fewer than MAX_CONCURRENT_LINK_REQUESTS run; a finishing request hands its slot on. */
  private async limitLinkRequest<T>(request: () => Promise<T>): Promise<T> {
    if (this.linkRequestsRunning < MAX_CONCURRENT_LINK_REQUESTS) {
      ++this.linkRequestsRunning
    } else {
      const { promise, resolve } = Promise.withResolvers<void>()
      this.linkRequestQueue.push(resolve)
      await promise
    }
    try {
      this.abortController.signal.throwIfAborted()
      return await request()
    } finally {
      const next = this.linkRequestQueue.shift()
      if (next) next()
      else --this.linkRequestsRunning
    }
  }

  private onDeparture(peerId: string): void {
    for (const recording of this.recordings) {
      for (const offer of recording.offers.values()) {
        if (offer.peerId != peerId) continue
        clearTimeout(offer.timer)
        recording.offers.delete(offer.sessionId)
      }
    }
    for (const { recording, incoming } of this.incoming.values()) {
      if (incoming.peerId != peerId) continue
      incoming.ended = true
      // Peer sessions keep what arrived; cloud sessions are left to the upgrade's finality rule, as the guest may
      // still be uploading after it left.
      if (!incoming.cloud) this.finishPeer(recording, incoming)
    }
  }

  private scheduleReoffer(recording: Recording, peerId: string): void {
    if (this.disposed || recording.stopped || this.current !== recording) return
    const timer = setTimeout(() => {
      recording.reofferTimers.delete(timer)
      if (this.members.has(peerId)) void this.offer(recording)
    }, REOFFER_DELAY_MS)
    recording.reofferTimers.add(timer)
  }

  private cancelOffers(recording: Recording, notify: boolean): void {
    for (const offer of recording.offers.values()) {
      clearTimeout(offer.timer)
      if (notify) this.client.sendHighQuality(offer.peerId, { type: 'hqCancel', sessionId: offer.sessionId })
    }
    recording.offers.clear()
  }

  /** Ends the open segment at the clips' audio length, which excludes any longer video. */
  private async closeSegment(recording: Recording): Promise<void> {
    const segmentIndex = openSegmentIndex(recording)
    if (segmentIndex == null) return
    const end = Math.min(...audioLengths(recording))
    recording.segments[segmentIndex].end = end
    this.cancelOffers(recording, !this.disposed)
    const changedClips = new Set<Clip>()
    for (const incoming of recording.sessions.values()) {
      if (incoming.segmentIndex != segmentIndex) continue
      if (incoming.cloud) {
        incoming.cloud.media.segmentEnd = end
        changedClips.add(incoming.clip)
      } else if (incoming.patch == 'open' || incoming.patch == 'finishing') {
        // A finished session still needs the end: the aligner places its last blocks only once it knows the file
        // stops growing there.
        recording.patch.segmentEnd(incoming.sessionId, end)
      }
    }
    await Promise.all(Array.from(changedClips, (clip) => this.saveClip(clip)))
  }

  private async onFinished(recording: Recording): Promise<void> {
    recording.stopped = true
    if (this.current === recording) this.current = null
    recording.reofferTimers.forEach((timer) => clearTimeout(timer))
    recording.reofferTimers.clear()
    await this.closeSegment(recording)
    this.cancelOffers(recording, !this.disposed)
    if (!this.disposed) {
      const waiting = new Set<string>()
      for (const incoming of recording.sessions.values()) {
        if (incoming.patch == 'open') waiting.add(incoming.username)
      }
      if (waiting.size > 0) {
        NotificationsController.showLongDurationMessage(`Waiting for high-quality audio from ${listNames(waiting)}.`)
      }
      recording.peerClips.forEach((clip) => this.notifyIfSettled(recording, clip))
    }
    await recording.ready
    const project = recording.project
    if (project) {
      for (const clip of recording.peerClips.values()) {
        if (!clip.meetingMedia) continue
        this.deps
          .scheduleUpgrade(project, clip, { liveSessions: this.liveSessions })
          .catch((error) => HighQualityMediaReceiver.logger.error(error))
      }
    }
    this.closeIfSettled(recording)
  }

  /**
   * A cloud session became final after the recording stopped: start the upgrade now instead of at its next poll.
   * Scheduling a clip whose upgrade is waiting wakes that run.
   */
  private wakeUpgrade(recording: Recording, clip: Clip): void {
    if (!recording.stopped || !recording.project || !clip.meetingMedia) return
    this.deps
      .scheduleUpgrade(recording.project, clip, { liveSessions: this.liveSessions })
      .catch((error) => HighQualityMediaReceiver.logger.error(error))
  }

  private onPatchSettled(recording: Recording, clip: Clip): void {
    this.notifyIfSettled(recording, clip)
    this.closeIfSettled(recording)
  }

  /** Reports a clip's peer upgrade once the recording stopped and every peer session of the clip has a result. */
  private notifyIfSettled(recording: Recording, clip: Clip): void {
    if (!recording.stopped || this.disposed || recording.notifiedClips.has(clip)) return
    let hqSamples = 0
    let sessions = 0
    let username: string | null = null
    for (const incoming of recording.sessions.values()) {
      if (incoming.clip !== clip || incoming.cloud) continue
      if (incoming.patch == 'open' || incoming.patch == 'finishing') return
      ++sessions
      username = incoming.username
      hqSamples += incoming.stats?.hqSamples ?? 0
    }
    if (sessions == 0 || username == null) return
    recording.notifiedClips.add(clip)
    if (hqSamples > 0) {
      const percent = Math.round((100 * hqSamples) / Math.max(1, clip.summary.length))
      NotificationsController.showLongDurationMessage(
        `Upgraded ${username}'s recording to high-quality audio (${percent}% of the recording).`,
      )
    } else if (!recording.failedClips.has(clip)) {
      NotificationsController.showLongDurationMessage(
        `No usable high-quality audio arrived from ${username}; kept the call audio.`,
      )
    }
  }

  /** The recording's patch work ends once it stopped and every peer session has its result. */
  private closeIfSettled(recording: Recording): void {
    if (!recording.stopped || recording.closed) return
    for (const incoming of recording.sessions.values()) {
      if (incoming.patch == 'open' || incoming.patch == 'finishing') return
    }
    this.closeRecording(recording)
  }

  private closeRecording(recording: Recording): void {
    if (recording.closed) return
    recording.closed = true
    recording.unregisterUpgrade()
    recording.patch.close()
    this.recordings.delete(recording)
  }

  private usernameOf(recording: Recording, peerId: string): string {
    return this.members.get(peerId) ?? recording.usernames.get(peerId) ?? peerId
  }

  private async saveClip(clip: Clip): Promise<void> {
    try {
      await this.deps.saveClip(clip)
    } catch (error) {
      HighQualityMediaReceiver.logger.error(error as Error)
    }
  }
}

function openSegmentIndex(recording: Recording): number | null {
  const index = recording.segments.length - 1
  return recording.segments[index].end == null ? index : null
}

function audioLengths(recording: Recording): number[] {
  return Array.from(recording.peerClips.values(), (clip) => clip.summary.length)
}

function isFrameCount(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= HQ_MAX_FRAME_SEQ
}

/** peerjs delivers messages it had to split as `Uint8Array`s. */
function normalizePcm(pcm: unknown): ArrayBuffer | null {
  let buffer: ArrayBuffer | null = null
  if (pcm instanceof ArrayBuffer) {
    buffer = pcm
  } else if (pcm instanceof Uint8Array) {
    buffer = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) as ArrayBuffer
  }
  return buffer?.byteLength == HQ_FRAME_BYTES ? buffer : null
}

function parseChunkName(name: string): { kind: 'audio' | 'video'; ordinal: number } | { kind: 'manifest' } | null {
  const match = CHUNK_NAME.exec(name)
  if (!match) return null
  if (match[1]) return { kind: 'audio', ordinal: Number(match[2]) }
  if (match[3]) return { kind: 'video', ordinal: Number(match[4]) }
  return { kind: 'manifest' }
}

function chunkName(kind: 'audio' | 'video', ordinal: number): string {
  return `${kind}-${String(ordinal).padStart(5, '0')}.${kind == 'audio' ? 'pcm' : 'part'}`
}

function maxChunkBytes(kind: ChunkKind): number {
  return kind == 'audio' ? MAX_AUDIO_CHUNK_BYTES : kind == 'video' ? HQ_VIDEO_CHUNK_BYTES : MAX_MANIFEST_BYTES
}

/** A file-system-safe name cut by code points, so a surrogate pair is never split. */
function safeName(name: string, maxCodePoints: number): string {
  return Array.from(ProjectArchive.getSafeFileTitle(name)).slice(0, maxCodePoints).join('').trimEnd()
}

function formatStartedAt(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}`
  )
}

function listNames(names: Iterable<string>): string {
  return Array.from(names).join(', ')
}
