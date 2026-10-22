/**
 * Places captured video frames on the recording timeline, which counts recorded audio samples.
 *
 * A frame's arrival on that timeline is late by delivery, main-thread work and, for guests, the receiver's jitter
 * buffer; its capture timestamp is not, but it runs on another clock. The smallest recent arrival-minus-capture offset
 * comes from the least-delayed delivery, so `capture + offset` keeps the capture spacing without jank while following
 * the audio clock's drift.
 */
export class VideoFrameClock {
  private window: Array<{ arrival: number; offset: number }> = []
  private lastCapture = -Infinity

  constructor(
    /** How long the least-delayed observation is trusted before slower ones may replace it. */
    private readonly windowSeconds = 10,
    /** A frame placed this much earlier than its arrival means the capture clock jumped back. */
    private readonly resetSeconds = 1,
  ) {}

  /** Both arguments and the result are in seconds; the result never exceeds `arrivalSeconds`. */
  map(captureSeconds: number, arrivalSeconds: number): number {
    if (!Number.isFinite(captureSeconds)) return arrivalSeconds
    // A repeated or decreasing capture timestamp means a new or broken capture clock: start over from arrival.
    if (!(captureSeconds > this.lastCapture)) this.reset()
    this.lastCapture = captureSeconds
    const offset = arrivalSeconds - captureSeconds
    if (this.window.length > 0 && offset - this.window[0]!.offset > this.resetSeconds) this.window = []
    while (this.window.length > 0 && this.window[this.window.length - 1]!.offset >= offset) this.window.pop()
    this.window.push({ arrival: arrivalSeconds, offset })
    while (this.window[0]!.arrival < arrivalSeconds - this.windowSeconds) this.window.shift()
    return captureSeconds + this.window[0]!.offset
  }

  /** Forgets the capture clock, e.g. for a replacement track. */
  reset(): void {
    this.window = []
    this.lastCapture = -Infinity
  }
}
