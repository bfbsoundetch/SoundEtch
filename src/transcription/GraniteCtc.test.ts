import {
  graniteRealOutputFrames,
  GraniteCtcDecoder,
  GraniteCtcFrontend,
  segmentSpeechFromVadProbabilities,
} from './GraniteCtc'
import type { GraniteFrontendConfig } from './GraniteCtc'

const config: GraniteFrontendConfig = {
  sample_rate: 16_000,
  n_fft: 512,
  win_length: 400,
  hop_length: 160,
  n_mels: 80,
  stack_factor: 2,
  deltas: true,
  delta_win_length: 3,
  logmel_floor_db: 8,
  num_special_tokens: 1,
  input_dim: 320,
  blank_id: 0,
  pad_multiple: 512,
  subsample_factor: 4,
}

const decoder = new GraniteCtcDecoder(['Ġhello', ',', 'Ġworld', 'Ã', '©'], 0, 1)

test('CTC collapse extends raw repeats and preserves identical tokens separated by blank', () => {
  expect(decoder.decodeWords(new Int32Array([1, 1, 0, 1]))).toEqual([
    { text: 'hello', startFrame: 0, endFrame: 2 },
    { text: 'hello', startFrame: 3, endFrame: 4 },
  ])
})

test('token spans preserve blank-separated repeats and word token indices', () => {
  const repeatedDecoder = new GraniteCtcDecoder(['h'], 0, 1)
  const spans = repeatedDecoder.decodeTokenSpans(new Int32Array([1, 1, 0, 1]))
  expect(spans).toEqual([
    { id: 1, startFrame: 0, endFrame: 2 },
    { id: 1, startFrame: 3, endFrame: 4 },
  ])
  expect(repeatedDecoder.groupWords(spans)).toEqual([
    {
      text: 'hh',
      startFrame: 0,
      endFrame: 4,
      firstToken: 0,
      lastToken: 1,
    },
  ])
})

test('ByteLevel word decoding ignores leading whitespace and attaches punctuation', () => {
  expect(decoder.decodeWords(new Int32Array([1, 2, 3]))).toEqual([
    { text: 'hello,', startFrame: 0, endFrame: 2 },
    { text: 'world', startFrame: 2, endFrame: 3 },
  ])
})

test('ByteLevel decoding preserves UTF-8 split across vocabulary pieces', () => {
  expect(decoder.decodeWords(new Int32Array([4, 5]))).toEqual([{ text: 'é', startFrame: 0, endFrame: 2 }])
})

test('front end creates official dimensions and 512-frame padding', () => {
  const frequencyBins = config.n_fft / 2 + 1
  const melFilters = new Float32Array(config.n_mels * frequencyBins).fill(1 / frequencyBins)
  const stftWindow = new Float32Array(config.n_fft).fill(1)
  const frontend = new GraniteCtcFrontend(config, melFilters, stftWindow)
  const audio = Float32Array.from({ length: 1_600 }, (_, index) => Math.sin(index / 10) * 0.1)

  const input = frontend.prepareInput(audio)

  expect(input.realFrames).toBe(5)
  expect(input.frames).toBe(512)
  expect(input.dimension).toBe(320)
  expect(input.data).toHaveLength(512 * 320)
  expect(Array.from(input.paddingMask.subarray(0, 6))).toEqual([0, 0, 0, 0, 0, 1])
  expect(input.data.subarray(0, input.realFrames * input.dimension).every(Number.isFinite)).toBe(true)

  expect(graniteRealOutputFrames(16)).toBe(4)
  expect(graniteRealOutputFrames(4)).toBe(1)
})

test('VAD segmentation keeps leading speech and clamps pre-speech padding to the interval', () => {
  // Speech from the very first frame: the old energy gate consumed an
  // unconditional calibration window and dropped leading words.
  const probabilities = new Float32Array(32).fill(0.9)
  expect(segmentSpeechFromVadProbabilities(probabilities, 512 * 32).segments).toEqual([{ startSample: 0, endSample: 16_384 }])
})

test('VAD segmentation closes a region after redemption, pads the end, and splits distant speech', () => {
  const probabilities = new Float32Array(60)
  probabilities.fill(0.9, 0, 10)
  probabilities.fill(0.0, 10, 43)
  probabilities.fill(0.9, 43)
  // Region 1: onset at frame 0 padded to 0; silence starts at frame 10
  // (5,120); redemption of 19 frames closes at frame 28 with a 300 ms tail.
  // Region 2: onset at frame 43 (22,016) padded back by 750 ms stays past
  // region 1's padded end, so the regions remain separate.
  expect(segmentSpeechFromVadProbabilities(probabilities, 512 * 60).segments).toEqual([
    { startSample: 0, endSample: 9_920 },
    { startSample: 10_016, endSample: 30_720 },
  ])
})

test('VAD segmentation keeps speech through a dip shorter than redemption', () => {
  const probabilities = new Float32Array(40)
  probabilities.fill(0.9)
  probabilities.fill(0.0, 12, 22)
  expect(segmentSpeechFromVadProbabilities(probabilities, 512 * 40).segments).toEqual([{ startSample: 0, endSample: 20_480 }])
})

test('VAD segmentation drops sub-minimum blips and covers the interval as a fallback', () => {
  const probabilities = new Float32Array(40)
  probabilities.fill(0.9, 5, 8)
  expect(segmentSpeechFromVadProbabilities(probabilities, 512 * 40).segments).toEqual([{ startSample: 0, endSample: 20_480 }])
})

test('audio without detected speech remains covered and every inference segment is capped at 20 seconds', () => {
  expect(segmentSpeechFromVadProbabilities(new Float32Array(0), 16_000 * 45).segments).toEqual([
    { startSample: 0, endSample: 320_000 },
    { startSample: 320_000, endSample: 640_000 },
    { startSample: 640_000, endSample: 720_000 },
  ])
})

test('VAD paragraph boundaries survive overlapping inference padding', () => {
  const probabilities = new Float32Array(60)
  probabilities.fill(0.9, 0, 10)
  probabilities.fill(0.9, 30)
  expect(segmentSpeechFromVadProbabilities(probabilities, 512 * 60)).toEqual({
    speechRegions: [
      { startSample: 0, endSample: 5_120 },
      { startSample: 15_360, endSample: 30_720 },
    ],
    segments: [{ startSample: 0, endSample: 30_720 }],
  })
})

test('long uninterrupted speech has one VAD paragraph despite capped inference chunks', () => {
  const samples = 16_000 * 45
  const probabilities = new Float32Array(Math.ceil(samples / 512)).fill(0.9)
  expect(segmentSpeechFromVadProbabilities(probabilities, samples)).toEqual({
    speechRegions: [{ startSample: 0, endSample: samples }],
    segments: [
      { startSample: 0, endSample: 319_744 },
      { startSample: 319_744, endSample: 639_232 },
      { startSample: 639_232, endSample: 720_000 },
    ],
  })
})

test('long speech is cut mid-pause before the 20-second cap, never through a word at the cap', () => {
  const samples = 16_000 * 45
  const probabilities = new Float32Array(Math.ceil(samples / 512)).fill(0.9)
  // A 10-frame pause, shorter than redemption, and a later 3-frame pause in the first search window.
  probabilities.fill(0.1, 560, 570)
  probabilities.fill(0.1, 600, 603)
  // No pause in the second search window; frame 1100 is the least speech-like.
  probabilities[1100] = 0.6
  expect(segmentSpeechFromVadProbabilities(probabilities, samples)).toEqual({
    speechRegions: [{ startSample: 0, endSample: samples }],
    segments: [
      // Middle of the longest pause: frame boundary 565.
      { startSample: 0, endSample: 289_280 },
      // Middle of frame 1100.
      { startSample: 289_280, endSample: 563_456 },
      { startSample: 563_456, endSample: 720_000 },
    ],
  })
})
