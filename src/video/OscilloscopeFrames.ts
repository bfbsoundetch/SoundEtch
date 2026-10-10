type FrameConsumer = (samples: Float32Array, sampleCount: number, frame: number) => Promise<void>

/** Partitions the rendered mix into contiguous video-frame windows without dropping PCM samples. */
export class OscilloscopeFrames {
  private readonly samples: Float32Array
  private position = 0
  private frame = 0
  private sampleCount = 0

  constructor(
    private readonly sampleRate: number,
    private readonly frameRate: number,
    private readonly length: number,
    private readonly channelCount: number,
  ) {
    this.samples = new Float32Array(Math.ceil(sampleRate / frameRate))
  }

  async addAudio(audio: Float32Array, consume: FrameConsumer): Promise<void> {
    let sourceFrame = 0
    const sourceFrameCount = audio.length / this.channelCount
    while (sourceFrame < sourceFrameCount && this.position < this.length) {
      // Use absolute boundaries, not rounded window lengths: fractional samples per frame must not drift.
      const end = Math.min(this.length, Math.floor(((this.frame + 1) * this.sampleRate) / this.frameRate))
      const count = Math.min(end - this.position, sourceFrameCount - sourceFrame)
      for (let i = 0; i < count; ++i) {
        let value = 0
        const offset = (sourceFrame + i) * this.channelCount
        for (let channel = 0; channel < this.channelCount; ++channel) {
          value += audio[offset + channel]
        }
        this.samples[this.sampleCount + i] = value / this.channelCount
      }
      sourceFrame += count
      this.position += count
      this.sampleCount += count
      if (this.position === end) {
        // The buffer is reused only after encoding has consumed this frame.
        await consume(this.samples, this.sampleCount, this.frame)
        this.sampleCount = 0
        ++this.frame
      }
    }
  }
}
