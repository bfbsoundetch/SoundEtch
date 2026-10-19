import { IntegratedLoudnessMeter } from '../analyzers/IntegratedLoudnessMeter'
import {
  normalizeTranscriptionLoudness,
  TRANSCRIPTION_LOUDNESS_LUFS,
  TRANSCRIPTION_MAX_GAIN_DB,
} from './TranscriptionLoudness'

const SAMPLE_RATE = 16_000

function sine(peakDbfs: number, seconds = 3): Float32Array {
  const amplitude = 10 ** (peakDbfs / 20)
  return Float32Array.from({ length: seconds * SAMPLE_RATE }, (_, n) => amplitude * Math.sin((2 * Math.PI * 1000 * n) / SAMPLE_RATE))
}

function loudness(samples: Float32Array): number {
  const meter = new IntegratedLoudnessMeter(SAMPLE_RATE, 1)
  meter.addInterleaved(samples)
  return meter.getIntegratedLoudness()
}

test.each([-45, -6])('a %d dBFS sine is scaled to the transcription loudness', (peakDbfs) => {
  const audio = sine(peakDbfs)
  const { gainDb } = normalizeTranscriptionLoudness(audio)
  expect(Math.sign(gainDb)).toBe(peakDbfs < -20 ? 1 : -1)
  expect(loudness(audio)).toBeCloseTo(TRANSCRIPTION_LOUDNESS_LUFS, 1)
})

test('gain is capped and leaves the signal sample-aligned from first to last frame', () => {
  const input = sine(-63)
  const audio = input.slice()
  const { measuredLufs, gainDb } = normalizeTranscriptionLoudness(audio)
  expect(TRANSCRIPTION_LOUDNESS_LUFS - measuredLufs).toBeGreaterThan(TRANSCRIPTION_MAX_GAIN_DB)
  expect(gainDb).toBe(TRANSCRIPTION_MAX_GAIN_DB)
  const gain = 10 ** (TRANSCRIPTION_MAX_GAIN_DB / 20)
  for (const index of [0, 1, 79, 80, 24_000, input.length - 81, input.length - 80, input.length - 1]) {
    expect(audio[index]).toBeCloseTo(input[index] * gain, 6)
  }
})

test('a click that the gain would push past full scale is limited to -1 dBFS without moving the speech around it', () => {
  const input = sine(-40)
  const click = 24_000
  input[click] = 0.5
  const audio = input.slice()
  const { gainDb } = normalizeTranscriptionLoudness(audio)
  const gain = 10 ** (gainDb / 20)
  expect(0.5 * gain).toBeGreaterThan(1)
  expect(Math.max(...audio.map(Math.abs))).toBeLessThanOrEqual(10 ** (-1 / 20) + 1e-6)
  for (const index of [click - 200, click + 16_000, input.length - 1]) {
    expect(audio[index]).toBeCloseTo(input[index] * gain, 5)
  }
})

test('digital silence is left unchanged', () => {
  const audio = new Float32Array(SAMPLE_RATE)
  expect(normalizeTranscriptionLoudness(audio)).toEqual({ measuredLufs: -Infinity, gainDb: 0 })
  expect(audio.every((sample) => sample === 0)).toBe(true)
})
