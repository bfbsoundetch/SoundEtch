import { Logger } from '../global/Logger'
import type { HighQualityMessage } from './RemoteMediaClient3'

/** The data channel's send buffer is kept below this, so frames never crowd out other messages for long. */
export const HQ_MAX_BUFFERED_BYTES = 32768
/** 30 minutes of frames wait for a stalled channel; older ones are dropped beyond that. */
export const HQ_MAX_QUEUED_FRAMES = 18000
export const HQ_MAX_FRAMES_PER_PUMP = 4
export const HQ_PUMP_INTERVAL_MS = 50
/** 1.5× real time while the recorder records, so a backlog never competes with the call for long. */
export const HQ_LIVE_FRAMES_PER_SECOND = 15

/** The part of the meeting client a peer session sends through. */
export interface PeerFrameChannel {
  sendHighQuality(peerId: string, message: HighQualityMessage): boolean
  getSendBufferedAmount(peerId: string): number | null
}

type QueuedFrame = { seq: number; pcm: ArrayBuffer }

const logger = new Logger('PeerAudioTransport')

/**
 * Sends one session's high-quality frames to the recorder over the meeting's data connection, paced so the backlog
 * after a stall drains without starving the call, then reports how many frames it captured and sent.
 */
export class PeerAudioTransport {
  private readonly queue = new Array<QueuedFrame>()
  /** Index of the oldest frame in `queue`; the array is compacted now and then rather than shifted per frame. */
  private head = 0
  private highestSeq = -1
  private sentCount = 0
  private credit = 0
  private lastTick = 0
  private timer: ReturnType<typeof setInterval> | null = null
  private ended = false
  private stopped = false
  private loggedOverflow = false

  /** `onStopped` runs once the session is over: ended and drained, dropped, or cancelled. */
  constructor(
    private readonly channel: PeerFrameChannel,
    private readonly recorderPeerId: string,
    private readonly sessionId: string,
    private readonly onStopped: () => void,
  ) {}

  /** Starts sending, once the recorder knows the session was accepted. Frames added earlier wait. */
  start() {
    if (this.stopped || this.timer) return
    this.lastTick = Date.now()
    this.timer = setInterval(() => this.pump(), HQ_PUMP_INTERVAL_MS)
  }

  addFrame(seq: number, pcm: ArrayBuffer) {
    if (this.stopped || this.ended) return
    this.highestSeq = Math.max(this.highestSeq, seq)
    this.queue.push({ seq, pcm })
    if (this.queue.length - this.head > HQ_MAX_QUEUED_FRAMES) {
      ++this.head
      if (!this.loggedOverflow) {
        this.loggedOverflow = true
        logger.errorMessage(`Session ${this.sessionId}: the send queue is full; dropping the oldest frames`)
      }
    }
    this.compact()
  }

  /** No more frames come; the rest is sent at full speed, then `hqEnd`. */
  end() {
    if (this.stopped) return
    this.ended = true
    // A session that never started (or a channel already gone) has nothing more to wait for.
    if (!this.timer) this.start()
  }

  /** Stops now and discards the rest, sending nothing more. */
  cancel() {
    this.stop()
  }

  private pump() {
    const now = Date.now()
    if (!this.ended) {
      this.credit = Math.min(
        HQ_MAX_FRAMES_PER_PUMP,
        this.credit + ((now - this.lastTick) * HQ_LIVE_FRAMES_PER_SECOND) / 1000,
      )
    }
    this.lastTick = now
    for (let sent = 0; sent < HQ_MAX_FRAMES_PER_PUMP && this.head < this.queue.length; ++sent) {
      if (!this.ended && this.credit < 1) break
      const buffered = this.channel.getSendBufferedAmount(this.recorderPeerId)
      if (buffered == null) return this.drop('the connection closed')
      if (buffered >= HQ_MAX_BUFFERED_BYTES) break
      const frame = this.queue[this.head]
      const message: HighQualityMessage = { type: 'hqFrame', sessionId: this.sessionId, seq: frame.seq, pcm: frame.pcm }
      if (!this.channel.sendHighQuality(this.recorderPeerId, message)) return this.drop('sending failed')
      ++this.head
      ++this.sentCount
      if (!this.ended) --this.credit
    }
    this.compact()
    if (this.ended && this.head == this.queue.length) {
      this.channel.sendHighQuality(this.recorderPeerId, {
        type: 'hqEnd',
        sessionId: this.sessionId,
        frameCount: this.highestSeq + 1,
        sentCount: this.sentCount,
      })
      this.stop()
    }
  }

  private drop(reason: string) {
    logger.log(`Session ${this.sessionId} dropped: ${reason}`)
    this.stop()
  }

  private stop() {
    if (this.stopped) return
    this.stopped = true
    clearInterval(this.timer ?? undefined)
    this.queue.length = 0
    this.head = 0
    this.onStopped()
  }

  private compact() {
    if (this.head > 1024 && this.head * 2 > this.queue.length) {
      this.queue.splice(0, this.head)
      this.head = 0
    }
  }
}
