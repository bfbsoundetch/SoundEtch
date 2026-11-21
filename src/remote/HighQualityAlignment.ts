import FFT from 'fft.js'
import { HQ_FRAME_SAMPLES, HQ_MAX_FRAME_SEQ } from './HighQualityAudioFormat'

const BLOCK_FRAMES = 50
const BLOCK_SAMPLES = BLOCK_FRAMES * HQ_FRAME_SAMPLES
const DECIMATION = 6
const MIN_CORRELATION = 0.5
/** −50 dBFS. */
const SILENCE_RMS = 0.00316
const NARROW_SEARCH_SAMPLES = 12000
const WIDE_SEARCH_SAMPLES = 96000
const FINE_SEARCH_SAMPLES = 12
const RESYNC_TOLERANCE_SAMPLES = 480
const INTERPOLATION_TOLERANCE_SAMPLES = 4800
const CROSSFADE_SAMPLES = 240
const MAX_HELD_BLOCKS = 12
const REORDER_SLACK_BLOCKS = 1
/** A block with fewer frames than this has too little audio to trust its correlation. */
const MIN_RECEIVED_FRAMES = BLOCK_FRAMES / 2

/** A stretch of high-quality audio to mix into the recorded file, at most one block long. */
export interface PatchSpan {
  filePosition: number
  sessionSample: number
  length: number
  /** File position where this span's run starts. */
  runStart: number
  /** File position where this span's run ends, when known; it is known whenever the run ends within fading reach. */
  runEnd: number | null
}

/** Session samples `[sessionSample, sessionSample + length)` placed at `filePosition` onwards. */
export interface Run {
  sessionSample: number
  filePosition: number
  length: number
}

/** Reads the recorded Opus audio of the member in file samples; zeros outside `[0, available)`. */
export type ReadOpus = (start: number, end: number) => Float32Array

interface RunState extends Run {
  /** Where the run's next frame goes, before clipping. */
  cursor: number
  lastFrame: number
  closed: boolean
  kept: boolean
}

interface SpanDraft {
  filePosition: number
  sessionSample: number
  length: number
  run: RunState
}

interface Prediction {
  position: number
  radius: number
}

/**
 * Places a meeting member's high-quality frames on the recorder's Opus recording of that member as both stream in.
 * Each 5 s block of frames is cross-correlated with the Opus around where it is expected; blocks that can't be
 * measured (silence, gaps) take their neighbours' offsets. Frames then become runs of consecutive samples in the file.
 */
export class StreamingAligner {
  private readonly priorFrame: number
  private readonly segmentStart: number
  private segmentEnd: number | null = null
  private readonly frames = new Map<number, Int16Array>()
  private highestSeq = -1
  private frameCount: number | null = null
  private nextBlock = 0
  /** The last confident block and its offset minus the block's session position. */
  private anchor: { block: number; residual: number } | null = null
  private readonly held: number[] = []
  private run: RunState | null = null
  /** The last placed block's spans, emitted once the next block is placed and their run's end is known. */
  private pending: SpanDraft[] = []
  private pendingBlock = -1
  private ready: PatchSpan[] = []
  private clipEnd = 0
  private done = false
  private readonly blockSamples = new Float32Array(BLOCK_SAMPLES)
  private readonly emittedRuns: Run[] = []
  private readonly counters = { blocks: 0, confident: 0, hqSamples: 0 }

  constructor(options: { priorFrame: number; segmentStart: number }) {
    this.priorFrame = options.priorFrame
    this.segmentStart = options.segmentStart
  }

  /** Returns false for a duplicate, a seq beyond `HQ_MAX_FRAME_SEQ`, or a frame whose block is already final. */
  addFrame(seq: number, pcm: Int16Array): boolean {
    if (!Number.isInteger(seq) || seq < 0 || seq > HQ_MAX_FRAME_SEQ || this.frames.has(seq)) {
      return false
    }
    if (this.frameCount !== null || Math.floor(seq / BLOCK_FRAMES) < this.finalBlockCount()) {
      return false
    }
    this.frames.set(seq, pcm)
    this.highestSeq = Math.max(this.highestSeq, seq)
    return true
  }

  setSegmentEnd(end: number): void {
    this.segmentEnd = end
  }

  /** No frame ≥ `frameCount` will come; frames still missing never will. */
  finish(frameCount: number): void {
    if (this.frameCount !== null) {
      return
    }
    this.frameCount = frameCount
    for (const seq of this.frames.keys()) {
      if (seq >= frameCount) {
        this.frames.delete(seq)
      }
    }
  }

  /**
   * Aligns at most `maxBlocks` blocks whose frames and Opus are complete and returns every span that became ready.
   * Spans come in session order, which is file order unless the delay dropped between two runs.
   */
  advance(readOpus: ReadOpus, opusAvailable: number, maxBlocks = Infinity): PatchSpan[] {
    const ready: PatchSpan[] = []
    this.ready = ready
    this.clipEnd = this.segmentEnd ?? opusAvailable
    const blockCount = this.finalBlockCount()
    for (let aligned = 0; aligned < maxBlocks && this.nextBlock < blockCount; ++aligned) {
      const prediction = this.predict(this.nextBlock)
      const searchEnd = prediction.position + BLOCK_SAMPLES + WIDE_SEARCH_SAMPLES
      if (opusAvailable < Math.min(this.segmentEnd ?? Infinity, searchEnd)) {
        break
      }
      this.alignBlock(this.nextBlock++, prediction, readOpus)
    }
    if (this.frameCount !== null && !this.done && this.nextBlock >= blockCount) {
      while (this.held.length > 0) {
        this.resolveOldestHeld()
      }
      this.closeRun()
      this.emitPending()
      this.done = true
    }
    this.ready = []
    return ready
  }

  /** The span's high-quality samples; zeros for frames released or never received. */
  samples(span: PatchSpan): Float32Array {
    const output = new Float32Array(span.length)
    let index = 0
    while (index < span.length) {
      const sessionSample = span.sessionSample + index
      const seq = Math.floor(sessionSample / HQ_FRAME_SAMPLES)
      const within = sessionSample - seq * HQ_FRAME_SAMPLES
      const count = Math.min(HQ_FRAME_SAMPLES - within, span.length - index)
      const pcm = this.frames.get(seq)
      if (pcm) {
        for (let k = 0; k < count; ++k) {
          output[index + k] = pcm[within + k] / 32768
        }
      }
      index += count
    }
    return output
  }

  /** Drops the frames that lie wholly below `sessionSample`. */
  release(sessionSample: number): void {
    for (const seq of this.frames.keys()) {
      if ((seq + 1) * HQ_FRAME_SAMPLES <= sessionSample) {
        this.frames.delete(seq)
      }
    }
  }

  /** `finish()` was called and every block was emitted. */
  get finished(): boolean {
    return this.done
  }

  get stats(): { readonly blocks: number; readonly confident: number; readonly hqSamples: number } {
    return this.counters
  }

  /** Every emitted run in session order, for mapping video timestamps. */
  get runs(): readonly Run[] {
    return this.emittedRuns
  }

  /** Frames currently stored: received but not yet released or dropped. */
  get heldFrames(): number {
    return this.frames.size
  }

  private finalBlockCount(): number {
    if (this.frameCount !== null) {
      return Math.ceil(this.frameCount / BLOCK_FRAMES)
    }
    return Math.max(0, Math.floor(this.highestSeq / BLOCK_FRAMES) - REORDER_SLACK_BLOCKS)
  }

  private predict(block: number): Prediction {
    if (this.anchor) {
      return { position: this.anchor.residual + block * BLOCK_SAMPLES, radius: NARROW_SEARCH_SAMPLES }
    }
    return { position: this.priorFrame + block * BLOCK_SAMPLES, radius: WIDE_SEARCH_SAMPLES }
  }

  private alignBlock(block: number, prediction: Prediction, readOpus: ReadOpus): void {
    this.counters.blocks++
    const offset = this.measure(block, prediction, readOpus)
    if (offset === null) {
      this.held.push(block)
      if (this.held.length > MAX_HELD_BLOCKS) {
        this.resolveOldestHeld()
      }
      return
    }
    this.counters.confident++
    const residual = offset - block * BLOCK_SAMPLES
    for (const heldBlock of this.held) {
      this.placeBlock(heldBlock, this.heldResidual(heldBlock, block, residual))
    }
    this.held.length = 0
    this.placeBlock(block, residual)
    this.anchor = { block, residual }
  }

  /** The block's offset in the file, or null when it isn't confident. */
  private measure(block: number, prediction: Prediction, readOpus: ReadOpus): number | null {
    const hq = this.blockSamples
    hq.fill(0)
    let received = 0
    let energy = 0
    for (let index = 0; index < BLOCK_FRAMES; ++index) {
      const pcm = this.frames.get(block * BLOCK_FRAMES + index)
      if (!pcm) {
        continue
      }
      received++
      const base = index * HQ_FRAME_SAMPLES
      for (let k = 0; k < HQ_FRAME_SAMPLES; ++k) {
        const value = pcm[k] / 32768
        hq[base + k] = value
        energy += value * value
      }
    }
    if (received < MIN_RECEIVED_FRAMES || Math.sqrt(energy / (received * HQ_FRAME_SAMPLES)) < SILENCE_RMS) {
      return null
    }
    let result = correlate(readOpus, hq, prediction.position, prediction.radius)
    if (result.ncc < MIN_CORRELATION && prediction.radius < WIDE_SEARCH_SAMPLES) {
      result = correlate(readOpus, hq, prediction.position, WIDE_SEARCH_SAMPLES)
    }
    return result.ncc >= MIN_CORRELATION ? result.offset : null
  }

  private heldResidual(block: number, confidentBlock: number, residual: number): number {
    const previous = this.anchor
    if (!previous) {
      return residual
    }
    if (Math.abs(residual - previous.residual) <= INTERPOLATION_TOLERANCE_SAMPLES) {
      const fraction = (block - previous.block) / (confidentBlock - previous.block)
      return Math.round(previous.residual + (residual - previous.residual) * fraction)
    }
    return block - previous.block <= confidentBlock - block ? previous.residual : residual
  }

  private resolveOldestHeld(): void {
    const block = this.held.shift()!
    if (this.anchor) {
      this.placeBlock(block, this.anchor.residual)
    } else {
      this.deleteBlockFrames(block, [])
    }
  }

  private placeBlock(block: number, residual: number): void {
    const offset = residual + block * BLOCK_SAMPLES
    const clipStart = Math.max(0, this.segmentStart)
    const firstFrame = block * BLOCK_FRAMES
    const drafts: SpanDraft[] = []
    for (let frame = firstFrame; frame < firstFrame + BLOCK_FRAMES; ++frame) {
      if (!this.frames.has(frame)) {
        continue
      }
      const desired = offset + (frame - firstFrame) * HQ_FRAME_SAMPLES
      const current = this.run
      const continues =
        current !== null &&
        !current.closed &&
        frame === current.lastFrame + 1 &&
        Math.abs(desired - current.cursor) <= RESYNC_TOLERANCE_SAMPLES
      const position = continues ? current.cursor : desired
      const start = Math.max(position, clipStart)
      const end = Math.min(position + HQ_FRAME_SAMPLES, this.clipEnd)
      if (!continues || start >= end) {
        this.closeRun()
      }
      if (start >= end) {
        continue
      }
      const sessionSample = frame * HQ_FRAME_SAMPLES + start - position
      let run: RunState
      if (continues) {
        run = current
        run.length += end - start
      } else {
        run = {
          filePosition: start,
          sessionSample,
          length: end - start,
          cursor: 0,
          lastFrame: 0,
          closed: false,
          kept: false,
        }
        this.run = run
      }
      run.cursor = position + HQ_FRAME_SAMPLES
      run.lastFrame = frame
      const last = drafts.at(-1)
      if (last && last.run === run && last.filePosition + last.length === start) {
        last.length += end - start
      } else {
        drafts.push({ filePosition: start, sessionSample, length: end - start, run })
      }
      if (end < position + HQ_FRAME_SAMPLES) {
        this.closeRun()
      }
    }
    // A run whose next frame is missing ends here, so its end is known before this block's spans are emitted.
    if (this.run && !this.run.closed && this.run.lastFrame !== firstFrame + BLOCK_FRAMES - 1) {
      this.closeRun()
    }
    this.emitPending()
    this.pending = drafts
    this.pendingBlock = block
  }

  private closeRun(): void {
    const run = this.run
    if (!run || run.closed) {
      return
    }
    run.closed = true
    run.kept = run.length >= 2 * CROSSFADE_SAMPLES
    if (run.kept) {
      this.emittedRuns.push({ sessionSample: run.sessionSample, filePosition: run.filePosition, length: run.length })
    }
  }

  private emitPending(): void {
    const kept = this.pending.filter((draft) => !draft.run.closed || draft.run.kept)
    for (const { filePosition, sessionSample, length, run } of kept) {
      const runEnd = run.closed ? run.filePosition + run.length : null
      this.ready.push({ filePosition, sessionSample, length, runStart: run.filePosition, runEnd })
      this.counters.hqSamples += length
    }
    if (this.pendingBlock >= 0) {
      this.deleteBlockFrames(this.pendingBlock, kept)
    }
    this.pending = []
    this.pendingBlock = -1
  }

  /** Frames no span uses are dropped now; the rest wait for `release`. */
  private deleteBlockFrames(block: number, spans: readonly SpanDraft[]): void {
    for (let frame = block * BLOCK_FRAMES; frame < (block + 1) * BLOCK_FRAMES; ++frame) {
      const start = frame * HQ_FRAME_SAMPLES
      const end = start + HQ_FRAME_SAMPLES
      if (!spans.some((span) => span.sessionSample < end && start < span.sessionSample + span.length)) {
        this.frames.delete(frame)
      }
    }
  }
}

/** Mixes `hq` into `output`, the span's current file samples, fading over `CROSSFADE_SAMPLES` at the run's edges. */
export function mixSpan(output: Float32Array, span: PatchSpan, hq: Float32Array): void {
  const runLength = (span.runEnd ?? Infinity) - span.runStart
  const first = span.filePosition - span.runStart
  for (let index = 0; index < span.length; ++index) {
    const j = first + index
    const weight = Math.min(1, (j + 1) / CROSSFADE_SAMPLES, (runLength - j) / CROSSFADE_SAMPLES)
    output[index] = output[index] * (1 - weight) + hq[index] * weight
  }
}

/**
 * The file position of a session sample: from the run that covers it, otherwise from the offset of the nearest run,
 * the one before on a tie. Null when there are no runs. `runs` are in session order.
 */
export function mapSessionSample(runs: readonly Run[], sessionSample: number): number | null {
  if (runs.length === 0) {
    return null
  }
  let low = 0
  let high = runs.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (runs[middle].sessionSample <= sessionSample) {
      low = middle + 1
    } else {
      high = middle
    }
  }
  const before = low > 0 ? runs[low - 1] : null
  const after = low < runs.length ? runs[low] : null
  let run: Run
  if (!before) {
    run = after!
  } else if (
    !after ||
    sessionSample - (before.sessionSample + before.length - 1) <= after.sessionSample - sessionSample
  ) {
    run = before
  } else {
    run = after
  }
  return run.filePosition - run.sessionSample + sessionSample
}

interface Correlation {
  offset: number
  ncc: number
}

class CorrelationWorkspace {
  readonly fft: FFT
  readonly input: Float64Array
  readonly opusSpectrum: Float64Array
  readonly hqSpectrum: Float64Array
  readonly product: Float64Array
  readonly result: Float64Array

  constructor(readonly size: number) {
    this.fft = new FFT(size)
    this.input = new Float64Array(size)
    this.opusSpectrum = new Float64Array(2 * size)
    this.hqSpectrum = new Float64Array(2 * size)
    this.product = new Float64Array(2 * size)
    this.result = new Float64Array(2 * size)
  }
}

/** Shared by every aligner: correlation is synchronous, and both search widths use the same FFT size. */
let workspace: CorrelationWorkspace | null = null

function getWorkspace(size: number): CorrelationWorkspace {
  if (workspace?.size !== size) {
    workspace = new CorrelationWorkspace(size)
  }
  return workspace
}

/** Finds where `hq` best matches the Opus within `radius` of `prediction`: coarsely by FFT, then sample-accurately. */
function correlate(readOpus: ReadOpus, hq: Float32Array, prediction: number, radius: number): Correlation {
  const start = prediction - radius
  const opus = readOpus(start, prediction + hq.length + radius)
  const opusDecimated = decimate(opus)
  const hqDecimated = decimate(hq)
  const space = getWorkspace(2 ** Math.ceil(Math.log2(opusDecimated.length + hqDecimated.length)))
  const { fft, input, opusSpectrum, hqSpectrum, product, result } = space

  input.fill(0)
  input.set(opusDecimated)
  fft.realTransform(opusSpectrum, input)
  fft.completeSpectrum(opusSpectrum)
  input.fill(0)
  input.set(hqDecimated)
  fft.realTransform(hqSpectrum, input)
  fft.completeSpectrum(hqSpectrum)
  for (let index = 0; index < product.length; index += 2) {
    const opusReal = opusSpectrum[index]
    const opusImaginary = opusSpectrum[index + 1]
    const hqReal = hqSpectrum[index]
    const hqImaginary = hqSpectrum[index + 1]
    product[index] = opusReal * hqReal + opusImaginary * hqImaginary
    product[index + 1] = opusImaginary * hqReal - opusReal * hqImaginary
  }
  fft.inverseTransform(result, product)

  const energyPrefix = new Float64Array(opusDecimated.length + 1)
  for (let index = 0; index < opusDecimated.length; ++index) {
    energyPrefix[index + 1] = energyPrefix[index] + opusDecimated[index] * opusDecimated[index]
  }
  const coarseLags = opusDecimated.length - hqDecimated.length + 1
  let bestLag = 0
  let bestScore = -Infinity
  for (let lag = 0; lag < coarseLags; ++lag) {
    const energy = energyPrefix[lag + hqDecimated.length] - energyPrefix[lag]
    const score = energy > 0 ? result[2 * lag] / Math.sqrt(energy) : 0
    if (score > bestScore) {
      bestScore = score
      bestLag = lag
    }
  }

  let hqEnergy = 0
  for (let index = 0; index < hq.length; ++index) {
    hqEnergy += hq[index] * hq[index]
  }
  const firstLag = Math.max(0, bestLag * DECIMATION - FINE_SEARCH_SAMPLES)
  const lastLag = Math.min(opus.length - hq.length, bestLag * DECIMATION + FINE_SEARCH_SAMPLES)
  let opusEnergy = 0
  for (let index = firstLag; index < firstLag + hq.length; ++index) {
    opusEnergy += opus[index] * opus[index]
  }
  let best: Correlation = { offset: start + firstLag, ncc: -Infinity }
  for (let lag = firstLag; lag <= lastLag; ++lag) {
    if (lag > firstLag) {
      opusEnergy += opus[lag + hq.length - 1] ** 2 - opus[lag - 1] ** 2
    }
    let dot = 0
    for (let index = 0; index < hq.length; ++index) {
      dot += opus[lag + index] * hq[index]
    }
    const denominator = Math.sqrt(Math.max(0, opusEnergy) * hqEnergy)
    const ncc = denominator > 0 ? dot / denominator : 0
    if (ncc > best.ncc) {
      best = { offset: start + lag, ncc }
    }
  }
  return best
}

/** Boxcar average over `DECIMATION` samples. */
function decimate(samples: Float32Array): Float64Array {
  const output = new Float64Array(Math.floor(samples.length / DECIMATION))
  for (let index = 0; index < output.length; ++index) {
    let sum = 0
    for (let k = 0; k < DECIMATION; ++k) {
      sum += samples[index * DECIMATION + k]
    }
    output[index] = sum / DECIMATION
  }
  return output
}
