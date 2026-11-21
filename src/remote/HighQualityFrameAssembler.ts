import { HQ_CAPTURE_QUANTUM, HQ_FRAME_SAMPLES } from './HighQualityAudioFormat'

/**
 * Cuts capture quanta into frames whose seq is their position since the capture started, so `seq · HQ_FRAME_SAMPLES`
 * is always the frame's first sample. Lost quanta therefore show up as missing seqs rather than shifting later audio.
 */
export class HighQualityFrameAssembler {
  private frame: Int16Array<ArrayBuffer> | null = null
  /** Samples of `frame` filled so far. */
  private filled = 0
  /** The sample position the next quantum must start at to continue the frame in progress. */
  private nextSample = -1

  constructor(private readonly onFrame: (seq: number, pcm: ArrayBuffer) => void) {}

  /** The 128 samples of quantum `index`; indexes only grow, and a skipped index is a gap. */
  addQuantum(index: number, samples: Int16Array): void {
    const start = index * HQ_CAPTURE_QUANTUM
    // Never padded: a frame with a hole would put later samples at the wrong position.
    if (start !== this.nextSample) this.filled = 0
    this.nextSample = start + HQ_CAPTURE_QUANTUM
    let offset = 0
    if (this.filled === 0) {
      // Fill only from a frame boundary, so a fresh frame starts exactly at its seq's position.
      offset = (HQ_FRAME_SAMPLES - (start % HQ_FRAME_SAMPLES)) % HQ_FRAME_SAMPLES
    }
    while (offset < HQ_CAPTURE_QUANTUM) {
      // A fresh buffer per frame, since each emitted one is transferred away.
      this.frame ??= new Int16Array(HQ_FRAME_SAMPLES)
      const count = Math.min(HQ_CAPTURE_QUANTUM - offset, HQ_FRAME_SAMPLES - this.filled)
      this.frame.set(samples.subarray(offset, offset + count), this.filled)
      this.filled += count
      offset += count
      if (this.filled === HQ_FRAME_SAMPLES) {
        const seq = (start + offset) / HQ_FRAME_SAMPLES - 1
        this.onFrame(seq, this.frame.buffer)
        this.frame = null
        this.filled = 0
      }
    }
  }
}
