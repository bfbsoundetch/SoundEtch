import { AudioControl, type AudioControlListener, isRecordingState } from '../audiocontext/AudioControl'
import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import { Logger } from '../global/Logger'
import { LocalMediaStreams } from '../mediastreams/LocalMediaStreams'
import { VideoTrackRecorder, type VideoTrackRecorderOptions } from '../recording/VideoTrackRecorder'
import {
  type CloudSessionChannel,
  CloudMediaTransport,
  HQ_UPLOAD_LOCK_NAME,
  type UploadFunction,
  type VideoRecorderLike,
} from './CloudMediaTransport'
import { uploadToLink } from './CloudUploadLink'
import { type FrameCapture, HighQualityAudioCapture } from './HighQualityAudioCapture'
import { HQ_UPLOAD_SPOOL_DIRECTORY } from './HighQualityAudioFormat'
import { type PeerFrameChannel, PeerAudioTransport } from './PeerAudioTransport'
import type { HighQualityListener, HighQualityMessage, Member, StateListener } from './RemoteMediaClient3'

/** How long leaving waits for the links a cloud session still needs. */
export const HQ_LEAVE_TIMEOUT_MS = 10000

/** The part of `RemoteMediaClient3` the sender uses. */
export interface HighQualityConnection extends PeerFrameChannel, CloudSessionChannel {
  addStateListener(listener: StateListener): void
  addHighQualityListener(listener: HighQualityListener): void
}

export interface HighQualityMediaSenderDeps {
  readonly createCapture: (onFrame: (seq: number, pcm: ArrayBuffer) => void) => FrameCapture
  readonly createVideoRecorder: (options: VideoTrackRecorderOptions) => VideoRecorderLike
  readonly upload: UploadFunction
  /** Whether this member records itself; its own recording then holds its media, so it spools nothing. */
  readonly isLocallyRecording: () => boolean
}

type Offer = Extract<HighQualityMessage, { type: 'hqOffer' }>

type Session = {
  readonly sessionId: string
  readonly recorderPeerId: string
  readonly micTrack: MediaStreamTrack
  readonly capture: FrameCapture
  readonly transport: PeerAudioTransport | CloudMediaTransport
  accepted: boolean
}

const logger = new Logger('HighQualityMediaSender')

const DEFAULT_DEPS: HighQualityMediaSenderDeps = {
  createCapture: (onFrame) => new HighQualityAudioCapture(onFrame),
  createVideoRecorder: (options) => new VideoTrackRecorder(options),
  upload: uploadToLink,
  isLocallyRecording: () => isRecordingState(AudioControl.getState()),
}

function liveMicTrack(): MediaStreamTrack | null {
  const track = LocalMediaStreams.localAVDeviceMediaStream.getAudioTracks()[0]
  return track?.readyState == 'live' ? track : null
}

function liveVideoTrack(): MediaStreamTrack | null {
  const track = LocalMediaStreams.localAVDeviceMediaStream.getVideoTracks()[0]
  return track?.readyState == 'live' ? track : null
}

/** Deletes spool files left by closed tabs, unless another tab is spooling now. */
async function clearAbandonedSpool() {
  const locks: LockManager | undefined = globalThis.navigator?.locks
  if (!locks) return
  try {
    await locks.request(HQ_UPLOAD_LOCK_NAME, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
      if (lock) await FileSystemUtils.deleteDirectory(HQ_UPLOAD_SPOOL_DIRECTORY)
    })
  } catch (error) {
    logger.errorMessage(`Could not clear the upload spool: ${error}`)
  }
}

/**
 * A meeting member's side of high-quality media: accepts one recorder's offer at a time, captures the microphone in
 * high quality, and sends it to that recorder over the data connection (peer) or through cloud upload links (cloud).
 */
export class HighQualityMediaSender {
  private readonly deps: HighQualityMediaSenderDeps
  private active: Session | null = null
  /** Cloud sessions until their uploads finish, the active one included. */
  private readonly cloudSessions = new Map<string, Session>()
  private lastMembers: readonly Member[] = []
  private disposed = false
  private readonly audioControlListener: AudioControlListener = () => this.reconcile()

  constructor(
    private readonly connection: HighQualityConnection,
    deps: Partial<HighQualityMediaSenderDeps> = {},
  ) {
    this.deps = { ...DEFAULT_DEPS, ...deps }
    void clearAbandonedSpool()
    connection.addHighQualityListener((peerId, message) => this.handleMessage(peerId, message))
    connection.addStateListener((state) => this.handleState(state.members))
    LocalMediaStreams.registerAVDeviceListener((_added, track) => this.handleDeviceChange(track))
    AudioControl.addAudioControlListener(this.audioControlListener)
  }

  /** Ends a cloud session and waits briefly for the links its remaining uploads need; they continue after leaving. */
  async prepareToLeave(): Promise<void> {
    const active = this.active
    if (active?.transport instanceof CloudMediaTransport) this.endSession(active)
    const linked = [...this.cloudSessions.values()].map((session) =>
      (session.transport as CloudMediaTransport).whenLinked(),
    )
    const timeout = Promise.withResolvers<void>()
    const timer = setTimeout(timeout.resolve, HQ_LEAVE_TIMEOUT_MS)
    await Promise.race([Promise.all(linked), timeout.promise])
    clearTimeout(timer)
  }

  /** Drops a peer session; cloud sessions keep uploading while their links last. Sends nothing more. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const listeners = AudioControl.audioControlListeners
    const index = listeners.indexOf(this.audioControlListener)
    if (index >= 0) listeners.splice(index, 1)
    const active = this.active
    this.active = null
    active?.capture.stop()
    if (active?.transport instanceof PeerAudioTransport) active.transport.cancel()
    for (const session of [...this.cloudSessions.values()]) {
      const transport = session.transport as CloudMediaTransport
      if (session.accepted) transport.detach()
      else transport.cancel()
    }
  }

  private handleMessage(peerId: string, message: HighQualityMessage) {
    if (this.disposed) return
    switch (message.type) {
      case 'hqOffer':
        void this.handleOffer(peerId, message)
        break
      case 'hqCancel': {
        const session = this.findSession(peerId, message.sessionId)
        if (!session) return
        if (this.active === session) {
          this.active = null
          session.capture.stop()
        }
        session.transport.cancel()
        break
      }
      case 'hqLinks': {
        const transport = this.findSession(peerId, message.sessionId)?.transport
        if (transport instanceof CloudMediaTransport) transport.addLinks(message.links)
        break
      }
    }
  }

  private findSession(peerId: string, sessionId: string): Session | null {
    const session = this.active?.sessionId == sessionId ? this.active : (this.cloudSessions.get(sessionId) ?? null)
    return session?.recorderPeerId == peerId ? session : null
  }

  private async handleOffer(peerId: string, offer: Offer) {
    const { sessionId } = offer
    const decline = (reason: Extract<HighQualityMessage, { type: 'hqDecline' }>['reason']) => {
      logger.log(`Declining session ${sessionId} from ${peerId}: ${reason}`)
      this.connection.sendHighQuality(peerId, { type: 'hqDecline', sessionId, reason })
    }
    if (this.active) {
      if (this.active.sessionId != sessionId) decline('busy')
      return
    }
    const micTrack = liveMicTrack()
    if (!micTrack) return decline('noMicrophone')
    if (offer.transport == 'cloud') {
      if (this.deps.isLocallyRecording()) return decline('recording')
      if (typeof globalThis.navigator?.storage?.getDirectory != 'function') return decline('unsupported')
    }

    const capture = this.deps.createCapture((seq, pcm) => {
      if (this.active === session) session.transport.addFrame(seq, pcm)
    })
    const onStopped = () => this.transportStopped(session)
    const transport =
      offer.transport == 'peer'
        ? new PeerAudioTransport(this.connection, peerId, sessionId, onStopped)
        : new CloudMediaTransport({
            channel: this.connection,
            recorderPeerId: peerId,
            recorderName: this.lastMembers.find((member) => member.peerId == peerId)?.username ?? 'the recorder',
            sessionId,
            video: offer.video,
            capture,
            createVideoRecorder: this.deps.createVideoRecorder,
            upload: this.deps.upload,
            onStopped,
          })
    const session: Session = { sessionId, recorderPeerId: peerId, micTrack, capture, transport, accepted: false }
    this.active = session
    if (transport instanceof CloudMediaTransport) {
      this.cloudSessions.set(sessionId, session)
      transport.attachVideo(liveVideoTrack())
    }

    const started = await capture.start(micTrack)
    if (this.active !== session) {
      // The session ended while the capture started.
      capture.stop()
      return
    }
    if (!started) {
      this.active = null
      this.connection.sendHighQuality(peerId, {
        type: 'hqFailed',
        sessionId,
        message: 'Could not capture the microphone in high quality.',
      })
      transport.cancel()
      return
    }
    session.accepted = true
    this.connection.sendHighQuality(peerId, { type: 'hqAccept', sessionId })
    if (transport instanceof PeerAudioTransport) transport.start()
    this.reconcile()
  }

  private transportStopped(session: Session) {
    this.cloudSessions.delete(session.sessionId)
    if (this.active !== session) return
    this.active = null
    session.capture.stop()
  }

  private handleState(members: readonly Member[]) {
    this.lastMembers = members
    if (this.disposed) return
    // A finished session still uploading needs no recorder, but it gets no more links once the recorder left.
    for (const session of [...this.cloudSessions.values()]) {
      if (session !== this.active && !members.some((member) => member.peerId == session.recorderPeerId)) {
        ;(session.transport as CloudMediaTransport).detach()
      }
    }
    this.reconcile()
  }

  private handleDeviceChange(track: MediaStreamTrack) {
    if (this.disposed) return
    const transport = this.active?.transport
    if (track.kind == 'video' && transport instanceof CloudMediaTransport) transport.attachVideo(liveVideoTrack())
    this.reconcile()
  }

  /** Ends the active session once anything it depends on changed. */
  private reconcile() {
    const session = this.active
    if (!session || this.disposed) return
    const recorder = this.lastMembers.find((member) => member.peerId == session.recorderPeerId)
    if (!recorder) return this.endSession(session, true)
    if (recorder.recordingActivity.state != 'recording' || liveMicTrack() !== session.micTrack) {
      return this.endSession(session)
    }
    if (session.transport instanceof CloudMediaTransport && this.deps.isLocallyRecording()) {
      // The member's own recording now holds its media; spooling it too would be a second copy.
      this.active = null
      session.capture.stop()
      this.connection.sendHighQuality(session.recorderPeerId, {
        type: 'hqFailed',
        sessionId: session.sessionId,
        message: 'recording started',
      })
      session.transport.cancel()
    }
  }

  /** Stops the capture and ends the transport; the recorder offers a new session if it still records. */
  private endSession(session: Session, recorderLeft = false) {
    this.active = null
    session.capture.stop()
    const transport = session.transport
    if (!session.accepted) transport.cancel()
    else if (transport instanceof PeerAudioTransport) {
      if (recorderLeft) transport.cancel()
      else transport.end()
    } else if (recorderLeft) transport.detach()
    else void transport.end()
  }
}
