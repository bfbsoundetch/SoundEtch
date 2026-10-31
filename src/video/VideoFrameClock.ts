type FrameConsumer = (frame: number, timestamp: number, duration: number, projectSample: number) => Promise<void>

/** Schedules constant-rate pictures from completed audio samples without copying or inspecting PCM. */
export class VideoFrameClock {
  private receivedSamples = 0
  private frame = 0
  private readonly frameCount: number
  private readonly duration: number

  constructor(
    private readonly sampleRate: number,
    private readonly frameRate: number,
    private readonly length: number,
    private readonly startSample = 0,
  ) {
    this.frameCount = Math.ceil((length * frameRate) / sampleRate)
    this.duration = length / sampleRate
  }

  async addSamples(count: number, consume: FrameConsumer): Promise<void> {
    this.receivedSamples = Math.min(this.length, this.receivedSamples + count)
    while (
      this.frame < this.frameCount &&
      Math.min(this.length, Math.floor(((this.frame + 1) * this.sampleRate) / this.frameRate)) <= this.receivedSamples
    ) {
      const timestamp = this.frame / this.frameRate
      const duration = Math.min((this.frame + 1) / this.frameRate, this.duration) - timestamp
      await consume(this.frame, timestamp, duration, this.startSample + (this.frame * this.sampleRate) / this.frameRate)
      ++this.frame
    }
  }
}
