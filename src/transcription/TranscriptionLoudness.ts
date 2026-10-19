import { IntegratedLoudnessMeter } from '../analyzers/IntegratedLoudnessMeter'
import { LimiterProcessor } from '../effects/limiter/LimiterProcessor'
import { GRANITE_SAMPLE_RATE } from './GraniteCtc'

/**
 * Silero's speech probabilities fall with input level, so quiet speech drops
 * out of the VAD regions and never reaches Granite. -16 LUFS is the podcast
 * export target; at -23 LUFS Silero already missed quiet words.
 */
export const TRANSCRIPTION_LOUDNESS_LUFS = -16
/** Reaches -16 LUFS from -56 LUFS; quieter intervals are mostly noise floor. */
export const TRANSCRIPTION_MAX_GAIN_DB = 40
const LIMITER_CEILING_DB = -1

export interface TranscriptionLoudness {
  /** Gated integrated loudness before normalization; -Infinity when no block passes the gates. */
  readonly measuredLufs: number
  readonly gainDb: number
}

/**
 * Scales 16 kHz mono audio in place to -16 LUFS gated loudness (ITU-R
 * BS.1770-4), boosting by at most 40 dB, then holds sample peaks at -1 dBFS
 * with the export limiter. Output stays sample-aligned with the input.
 * Unmeasurable audio is left unchanged.
 */
export function normalizeTranscriptionLoudness(audio: Float32Array): TranscriptionLoudness {
  const meter = new IntegratedLoudnessMeter(GRANITE_SAMPLE_RATE, 1)
  meter.addInterleaved(audio)
  const measuredLufs = meter.getIntegratedLoudness()
  if (!Number.isFinite(measuredLufs)) {
    return { measuredLufs, gainDb: 0 }
  }

  const gainDb = Math.min(TRANSCRIPTION_MAX_GAIN_DB, TRANSCRIPTION_LOUDNESS_LUFS - measuredLufs)
  const gain = 10 ** (gainDb / 20)
  for (let index = 0; index < audio.length; ++index) {
    audio[index] *= gain
  }

  const limiter = new LimiterProcessor({ processorOptions: { sampleRate: GRANITE_SAMPLE_RATE } })
  const parameters = {
    ceiling: Float32Array.of(LIMITER_CEILING_DB),
    release: Float32Array.of(LimiterProcessor.parameterDescriptors.find((d) => d.name === 'release')!.defaultValue!),
  }
  // The limiter reads each frame before writing its output there, so it runs
  // in place. Its output lags by the lookahead: shift it back, then flush the
  // last frames out of the delay line. A measured 400 ms loudness block is
  // longer than the 5 ms lookahead.
  const latency = limiter.lookaheadSamples
  limiter.process([[audio]], [[audio]], parameters)
  audio.copyWithin(0, latency)
  const tail = new Float32Array(latency)
  limiter.process([[tail]], [[tail]], parameters)
  audio.set(tail, audio.length - latency)
  return { measuredLufs, gainDb }
}
