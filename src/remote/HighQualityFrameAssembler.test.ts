import { expect, test } from 'vitest'
import { HQ_CAPTURE_QUANTUM, HQ_FRAME_SAMPLES } from './HighQualityAudioFormat'
import { HighQualityFrameAssembler } from './HighQualityFrameAssembler'

/** Sample `s` of the capture has the value `s mod 32749`, so a frame shows where its samples came from. */
function sampleAt(position: number) {
  return position % 32749
}

function assemble(indexes: Iterable<number>) {
  const frames: Array<{ seq: number; pcm: Int16Array }> = []
  const assembler = new HighQualityFrameAssembler((seq, pcm) => frames.push({ seq, pcm: new Int16Array(pcm) }))
  for (const index of indexes) {
    assembler.addQuantum(
      index,
      Int16Array.from({ length: HQ_CAPTURE_QUANTUM }, (_, i) => sampleAt(index * HQ_CAPTURE_QUANTUM + i)),
    )
  }
  return frames
}

function expectFrameAtItsPosition(frame: { seq: number; pcm: Int16Array }) {
  const expected = Int16Array.from({ length: HQ_FRAME_SAMPLES }, (_, i) => sampleAt(frame.seq * HQ_FRAME_SAMPLES + i))
  expect(frame.pcm).toEqual(expected)
}

function range(start: number, end: number) {
  return Array.from({ length: end - start }, (_, i) => start + i)
}

test('contiguous quanta make frames of 37.5 quanta equal to the input, holding the rest', () => {
  const frames = assemble(range(0, 100))
  expect(frames.map((frame) => frame.seq)).toEqual([0, 1])
  frames.forEach(expectFrameAtItsPosition)
  expect(new Set(frames.map((frame) => frame.pcm.buffer)).size).toBe(2)
})

test('a gap drops the frames it touches, and later frames keep the seqs of their positions', () => {
  // Frame 3 spans quanta 112.5–150. Skipping 140 drops frame 3 only.
  expect(assemble([...range(0, 140), ...range(141, 250)]).map((frame) => frame.seq)).toEqual([0, 1, 2, 4, 5])
  // Skipping 148–151 reaches into frame 4 (150–187.5), so it goes too.
  const frames = assemble([...range(0, 148), ...range(152, 250)])
  expect(frames.map((frame) => frame.seq)).toEqual([0, 1, 2, 5])
  frames.forEach(expectFrameAtItsPosition)
})

test('a first quantum mid-frame starts filling at the next frame boundary', () => {
  // Quantum 20 is inside frame 0; frame 1 starts at quantum 37.5.
  const frames = assemble(range(20, 120))
  expect(frames.map((frame) => frame.seq)).toEqual([1, 2])
  frames.forEach(expectFrameAtItsPosition)
})
