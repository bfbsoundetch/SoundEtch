import { expect, test } from 'vitest'
import { HQ_FRAME_SAMPLES, HQ_SAMPLE_RATE } from './HighQualityAudioFormat'
import { mapSessionSample, mixSpan, StreamingAligner } from './HighQualityAlignment'
import type { PatchSpan, ReadOpus } from './HighQualityAlignment'

const DELAY = 7321
const SECONDS = 60
const BLOCK_SAMPLES = 50 * HQ_FRAME_SAMPLES

function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

/** Syllables of voiced harmonics plus breathy noise, separated by short pauses, as int16. */
function makeSpeech(seconds: number, seed: number): Int16Array {
  const random = seededRandom(seed)
  const output = new Int16Array(seconds * HQ_SAMPLE_RATE)
  let position = 0
  let breath = 0
  while (position < output.length) {
    position += Math.floor((0.05 + random() * 0.25) * HQ_SAMPLE_RATE)
    const length = Math.floor((0.1 + random() * 0.25) * HQ_SAMPLE_RATE)
    const pitch = 100 + random() * 150
    const loudness = 0.1 + random() * 0.2
    for (let index = 0; index < length && position + index < output.length; ++index) {
      const envelope = Math.sin((Math.PI * index) / length)
      let voiced = 0
      for (let harmonic = 1; harmonic <= 4; ++harmonic) {
        voiced += Math.sin((2 * Math.PI * pitch * harmonic * index) / HQ_SAMPLE_RATE) / harmonic
      }
      breath += 0.3 * (random() * 2 - 1 - breath)
      const value = loudness * envelope * (0.5 * voiced + 1.5 * breath)
      output[position + index] = Math.round(Math.max(-1, Math.min(1, value)) * 32767)
    }
    position += length
  }
  return output
}

/**
 * The recorder's "Opus" of `hq`: lowpassed, with −40 dB noise, where `sessionPosition` maps a file sample to the
 * session sample heard there (null for concealment).
 */
function makeOpus(hq: Int16Array, sessionPosition: (filePosition: number) => number | null, seed: number) {
  const random = seededRandom(seed)
  const lowpassed = new Float32Array(hq.length)
  let state = 0
  for (let index = 0; index < hq.length; ++index) {
    state += 0.6 * (hq[index] / 32768 - state)
    lowpassed[index] = state
  }
  const output = new Float32Array(hq.length + DELAY + HQ_SAMPLE_RATE)
  for (let index = 0; index < output.length; ++index) {
    let value = (random() * 2 - 1) * 0.01 * Math.sqrt(3)
    const source = sessionPosition(index)
    if (source !== null && source >= 0 && source < hq.length - 1) {
      const whole = Math.floor(source)
      const fraction = source - whole
      value += lowpassed[whole] * (1 - fraction) + lowpassed[whole + 1] * fraction
    }
    output[index] = value
  }
  return output
}

function reader(opus: Float32Array, available: number): ReadOpus {
  return (start, end) => {
    const output = new Float32Array(end - start)
    const from = Math.max(start, 0)
    const to = Math.min(end, available, opus.length)
    if (to > from) {
      output.set(opus.subarray(from, to), from - start)
    }
    return output
  }
}

const frameOf = (hq: Int16Array, seq: number) => hq.slice(seq * HQ_FRAME_SAMPLES, (seq + 1) * HQ_FRAME_SAMPLES)

function alignAllAtOnce(
  hq: Int16Array,
  opus: Float32Array,
  options: { skip?: (seq: number) => boolean; segmentEnd?: number } = {},
) {
  const aligner = new StreamingAligner({ priorFrame: 0, segmentStart: 0 })
  const frameCount = hq.length / HQ_FRAME_SAMPLES
  for (let seq = 0; seq < frameCount; ++seq) {
    if (!options.skip?.(seq)) {
      expect(aligner.addFrame(seq, frameOf(hq, seq))).toBe(true)
    }
  }
  aligner.finish(frameCount)
  aligner.setSegmentEnd(options.segmentEnd ?? opus.length)
  const spans = aligner.advance(reader(opus, opus.length), opus.length)
  expect(aligner.finished).toBe(true)
  return { aligner, spans }
}

const speech = makeSpeech(SECONDS, 1)
const constantOpus = makeOpus(speech, (position) => position - DELAY, 2)
const constant = alignAllAtOnce(speech, constantOpus)

function offsets(items: readonly { filePosition: number; sessionSample: number }[]) {
  return items.map((item) => item.filePosition - item.sessionSample)
}

test('a constant delay is found to within 2 samples and covers the session', () => {
  const { aligner, spans } = constant
  expect(aligner.runs.length).toBeGreaterThan(0)
  for (const offset of [...offsets(aligner.runs), ...offsets(spans)]) {
    expect(Math.abs(offset - DELAY)).toBeLessThanOrEqual(2)
  }
  const sessionEnd = DELAY + SECONDS * HQ_SAMPLE_RATE
  let covered = 0
  for (const span of spans) {
    covered += Math.max(0, Math.min(sessionEnd, span.filePosition + span.length) - Math.max(DELAY, span.filePosition))
  }
  expect(covered / (SECONDS * HQ_SAMPLE_RATE)).toBeGreaterThanOrEqual(0.95)
  expect(aligner.stats.confident).toBe(aligner.stats.blocks)

  const span = spans[3]
  const expected = Float32Array.from(
    speech.subarray(span.sessionSample, span.sessionSample + span.length),
    (value) => value / 32768,
  )
  expect(aligner.samples(span)).toEqual(expected)
})

test('a live feed with reordered frames emits the same spans as feeding everything at once', () => {
  const random = seededRandom(3)
  const frameCount = speech.length / HQ_FRAME_SAMPLES
  const order = Array.from({ length: frameCount }, (_, seq) => ({ seq, key: seq + random() * 3 }))
    .sort((a, b) => a.key - b.key)
    .map(({ seq }) => seq)
  const aligner = new StreamingAligner({ priorFrame: 0, segmentStart: 0 })
  const spans: PatchSpan[] = []
  order.forEach((seq, step) => {
    expect(aligner.addFrame(seq, frameOf(speech, seq))).toBe(true)
    const available = Math.min(constantOpus.length, (step + 1) * HQ_FRAME_SAMPLES + DELAY)
    spans.push(...aligner.advance(reader(constantOpus, available), available, 1))
  })
  aligner.finish(frameCount)
  aligner.setSegmentEnd(constantOpus.length)
  while (!aligner.finished) {
    spans.push(...aligner.advance(reader(constantOpus, constantOpus.length), constantOpus.length, 1))
  }
  expect(spans).toEqual(constant.spans)
  expect(aligner.runs).toEqual(constant.aligner.runs)
})

test('a drifting clock keeps every run start within the resync tolerance', () => {
  const drift = 1 + 50e-6
  const opus = makeOpus(speech, (position) => (position - DELAY) / drift, 4)
  const { aligner } = alignAllAtOnce(speech, opus)
  expect(aligner.runs.length).toBeGreaterThan(0)
  for (const run of aligner.runs) {
    const trueDelay = DELAY + run.sessionSample * (drift - 1)
    expect(Math.abs(run.filePosition - run.sessionSample - trueDelay)).toBeLessThanOrEqual(480 + 2)
  }
})

test('a 960-sample jump starts a new run in its block', () => {
  const jumpAt = 30 * HQ_SAMPLE_RATE
  const opus = makeOpus(
    speech,
    (position) => {
      const session = position - DELAY
      if (session < jumpAt) {
        return session
      }
      return session < jumpAt + 960 ? null : session - 960
    },
    5,
  )
  const { aligner } = alignAllAtOnce(speech, opus)
  const later = aligner.runs.filter((run) => run.sessionSample >= jumpAt)
  expect(later[0].sessionSample).toBeLessThan(jumpAt + BLOCK_SAMPLES)
  for (const offset of offsets(later)) {
    expect(Math.abs(offset - DELAY - 960)).toBeLessThanOrEqual(2)
  }
})

test('missing frames are never patched', () => {
  const { spans } = alignAllAtOnce(speech, constantOpus, { skip: (seq) => seq >= 100 && seq <= 104 })
  const gapStart = DELAY + 100 * HQ_FRAME_SAMPLES
  const gapEnd = DELAY + 105 * HQ_FRAME_SAMPLES
  expect(spans.length).toBeGreaterThan(0)
  for (const span of spans) {
    expect(span.filePosition + span.length <= gapStart || span.filePosition >= gapEnd).toBe(true)
  }
})

test('blocks held through 70 s of silence resolve with the first confident block', () => {
  const hq = new Int16Array(90 * HQ_SAMPLE_RATE)
  hq.set(makeSpeech(20, 6), 70 * HQ_SAMPLE_RATE)
  const opus = makeOpus(hq, (position) => position - DELAY, 7)
  const aligner = new StreamingAligner({ priorFrame: 0, segmentStart: 0 })
  const frameCount = hq.length / HQ_FRAME_SAMPLES
  for (let seq = 0; seq < frameCount; ++seq) {
    aligner.addFrame(seq, frameOf(hq, seq))
  }
  aligner.finish(frameCount)
  aligner.setSegmentEnd(opus.length)
  const batches: PatchSpan[][] = []
  while (!aligner.finished) {
    batches.push(aligner.advance(reader(opus, opus.length), opus.length, 1))
  }
  const firstConfidentBlock = 14
  expect(batches.slice(0, firstConfidentBlock).every((batch) => batch.length === 0)).toBe(true)
  const spans = batches.flat()
  // 14 silent blocks, of which only the newest MAX_HELD_BLOCKS were still held.
  expect(spans[0].sessionSample).toBe(2 * BLOCK_SAMPLES)
  for (const offset of offsets(spans)) {
    expect(Math.abs(offset - DELAY)).toBeLessThanOrEqual(2)
  }
  expect(aligner.stats.confident).toBe(4)
})

test('an all-zero session emits nothing', () => {
  const { aligner, spans } = alignAllAtOnce(new Int16Array(speech.length), constantOpus)
  expect(spans).toEqual([])
  expect(aligner.runs).toEqual([])
  expect(aligner.heldFrames).toBe(0)
})

test('spans end at segmentEnd', () => {
  const segmentEnd = 40 * HQ_SAMPLE_RATE
  const { spans } = alignAllAtOnce(speech, constantOpus, { segmentEnd })
  expect(Math.max(...spans.map((span) => span.filePosition + span.length))).toBe(segmentEnd)
})

test('mixSpan replaces the interior and fades over 240 samples at both run edges', () => {
  const file = new Float32Array(3000).fill(1)
  const run = { runStart: 1000, runEnd: 2000 }
  // The fade-out starts in the first span and ends in the second.
  const spans: PatchSpan[] = [
    { filePosition: 1000, sessionSample: 0, length: 900, ...run },
    { filePosition: 1900, sessionSample: 900, length: 100, ...run },
  ]
  for (const span of spans) {
    const output = file.subarray(span.filePosition, span.filePosition + span.length)
    mixSpan(output, span, new Float32Array(span.length))
  }
  for (let j = 0; j < 240; ++j) {
    expect(file[1000 + j]).toBeCloseTo(1 - (j + 1) / 240, 6)
    expect(file[1999 - j]).toBeCloseTo(1 - (j + 1) / 240, 6)
  }
  expect(file.subarray(1240, 1760).every((value) => value === 0)).toBe(true)
  expect(file.subarray(0, 1000).every((value) => value === 1)).toBe(true)
  expect(file.subarray(2000).every((value) => value === 1)).toBe(true)
})

test('a span emitted before its run ends knows the run end when the fade-out reaches into it', () => {
  // The run ends 100 samples into block 2, so its fade-out starts in block 1's span.
  const segmentEnd = DELAY + 2 * BLOCK_SAMPLES + 100
  const { spans } = alignAllAtOnce(speech, constantOpus, { segmentEnd })
  const previous = spans.find((span) => span.filePosition + span.length === DELAY + 2 * BLOCK_SAMPLES)!
  expect(previous.runEnd).toBe(segmentEnd)
  const weights = new Float32Array(segmentEnd)
  for (const span of spans) {
    mixSpan(
      weights.subarray(span.filePosition, span.filePosition + span.length),
      span,
      new Float32Array(span.length).fill(1),
    )
  }
  for (let j = 0; j < 240; ++j) {
    expect(weights[segmentEnd - 1 - j]).toBeCloseTo((j + 1) / 240, 6)
  }
})

test('mapSessionSample maps inside and between runs', () => {
  const runs = [
    { sessionSample: 0, filePosition: 1000, length: 500 },
    { sessionSample: 1000, filePosition: 3000, length: 500 },
  ]
  expect(mapSessionSample([], 0)).toBe(null)
  expect(mapSessionSample(runs, 100)).toBe(1100)
  expect(mapSessionSample(runs, 1200)).toBe(3200)
  expect(mapSessionSample(runs, 600)).toBe(1600)
  expect(mapSessionSample(runs, 749)).toBe(1749)
  expect(mapSessionSample(runs, 900)).toBe(2900)
  expect(mapSessionSample(runs, -100)).toBe(900)
  expect(mapSessionSample(runs, 2000)).toBe(4000)
})
