import {
  buildSpeechSupportMask,
  computeFrameEnergies,
  ctcTokenPosteriors,
  refineGraniteWords,
  timedWordsToTranscribedRanges,
  timeGraniteWords,
  type CtcTokenBoundary,
} from './GraniteTiming'

function enumeratedBoundaries(scores: Float32Array, frames: number, tokens: readonly number[]) {
  const states = tokens.length * 2 + 1
  const columns = tokens.length + 1
  const weights = tokens.map(() => ({
    start: new Array<number>(frames).fill(0),
    end: new Array<number>(frames).fill(0),
  }))

  const visit = (path: number[], score: number): void => {
    if (path.length === frames) {
      if (path[path.length - 1] < states - 2) {
        return
      }
      const weight = Math.exp(score)
      for (let token = 0; token < tokens.length; ++token) {
        const state = token * 2 + 1
        weights[token].start[path.indexOf(state)] += weight
        weights[token].end[path.lastIndexOf(state)] += weight
      }
      return
    }

    const current = path[path.length - 1]
    const candidates = current === undefined ? [0, 1] : [current, current + 1, current + 2]
    for (const next of candidates) {
      if (next >= states) {
        continue
      }
      if (next === current + 2 && (next % 2 === 0 || tokens[(next - 1) / 2] === tokens[(next - 3) / 2])) {
        continue
      }
      const column = next % 2 === 1 ? (next + 1) / 2 : 0
      visit([...path, next], score + scores[path.length * columns + column])
    }
  }
  visit([], 0)

  const boundaryQuantiles = (values: readonly number[], offset: number) => {
    const total = values.reduce((sum, value) => sum + value, 0)
    const result = new Array<number>(3)
    const thresholds = [0.05, 0.5, 0.95]
    for (let threshold = 0; threshold < thresholds.length; ++threshold) {
      let sum = 0
      result[threshold] =
        values.findIndex((value) => {
          sum += value
          return sum >= thresholds[threshold] * total
        }) + offset
    }
    return { low: result[0], median: result[1], high: result[2] }
  }
  return weights.map(({ start, end }) => ({
    start: boundaryQuantiles(start, 0),
    end: boundaryQuantiles(end, 1),
  }))
}

function geometry(words: readonly { start: number; end: number }[]) {
  return words.map(({ start, end }) => ({ start, end }))
}

test('CTC boundaries equal exhaustive path enumeration and ignore common frame offsets', () => {
  for (const tokens of [
    [4, 7],
    [7, 7],
  ]) {
    const scores = Float32Array.from([
      0.3,
      1.4,
      tokens[0] === tokens[1] ? 1.4 : -0.8,
      0.1,
      0.7,
      tokens[0] === tokens[1] ? 0.7 : 0.4,
      1.5,
      -0.2,
      tokens[0] === tokens[1] ? -0.2 : 0.9,
      0.4,
      0.6,
      tokens[0] === tokens[1] ? 0.6 : 1.2,
      1.1,
      -0.3,
      tokens[0] === tokens[1] ? -0.3 : 0.2,
    ])
    expect(ctcTokenPosteriors(scores, 5, tokens)).toEqual(enumeratedBoundaries(scores, 5, tokens))
    const shifted = Float32Array.from(scores, (value, index) => value + 10_000 * (1 + Math.floor(index / 3)))
    expect(ctcTokenPosteriors(shifted, 5, tokens)).toEqual(ctcTokenPosteriors(scores, 5, tokens))
  }
})

test('repeated transcript tokens require an intervening blank frame', () => {
  expect(ctcTokenPosteriors(new Float32Array(6), 2, [7, 7])).toBeNull()
  expect(ctcTokenPosteriors(new Float32Array(9), 3, [7, 7])).toEqual([
    {
      start: { low: 0, median: 0, high: 0 },
      end: { low: 1, median: 1, high: 1 },
    },
    {
      start: { low: 2, median: 2, high: 2 },
      end: { low: 3, median: 3, high: 3 },
    },
  ])
})

test('nearby acoustic edges cannot collapse a preceding short word', () => {
  const words = [
    { text: 'the', start: 5.554, end: 5.634 },
    { text: 'president', start: 5.714, end: 5.794 },
  ]
  const speech = new Uint8Array(220)
  speech.fill(1, 177, 179)
  expect(geometry(refineGraniteWords(words, speech, Float32Array.from(speech), 0.032, 0, 7))).toEqual([
    { start: 5.554, end: 5.714 },
    { start: 5.714, end: 5.794 },
  ])
})

test('a first word emitted in the segment pre-roll moves onto its speech without reaching the next word', () => {
  // Fireside Chat: the segment starts 750 ms before "friends"; Granite put "my" in that silence.
  const words = [
    { text: 'my', start: 10.45, end: 10.53 },
    { text: 'friends', start: 11.01, end: 11.33 },
  ]
  const speech = new Uint8Array(400)
  speech.fill(1, 339, 343)
  speech.fill(1, 347, 358)
  const [my, friends] = refineGraniteWords(words, speech, Float32Array.from(speech), 0.032, 10.4, 30.4)
  expect(geometry([my])).toEqual([{ start: 339 * 0.032, end: 343 * 0.032 }])
  expect(friends.start).toBe(11.01)
})

test('leading-word relocation is limited to the pre-roll and ignores earlier segments and one-frame clicks', () => {
  const late = [{ text: 'late', start: 11.3, end: 11.38 }]
  const distantSpeech = new Uint8Array(400).fill(1, 370, 376)
  const refineLate = (segmentStart: number) =>
    geometry(refineGraniteWords(late, distantSpeech, Float32Array.from(distantSpeech), 0.032, segmentStart, 30))
  expect(refineLate(10.4)).toEqual(geometry(late))
  expect(refineLate(10.6)).toEqual([{ start: 370 * 0.032, end: 376 * 0.032 }])

  const words = [
    { text: 'my', start: 10.45, end: 10.53 },
    { text: 'friends', start: 11.04, end: 11.3 },
  ]
  const speech = new Uint8Array(400)
  speech.fill(1, 320, 326) // previous segment, including the frame straddling the 10.41 s start
  speech[335] = 1 // click
  speech.fill(1, 340, 344)
  speech.fill(1, 346, 356)
  const [my] = refineGraniteWords(words, speech, Float32Array.from(speech), 0.032, 10.41, 30.41)
  expect(geometry([my])).toEqual([{ start: 340 * 0.032, end: 344 * 0.032 }])
})

test('a leading word in a pause the VAD still marks as speech moves onto the louder speech that follows', () => {
  // A 20-second chunk boundary inside one speech region: Silero stays above the mask threshold
  // through the pause, so only energy distinguishes the pause from "which".
  const words = [
    { text: 'which', start: 0.02, end: 0.1 },
    { text: 'may', start: 0.6, end: 0.8 },
  ]
  const speech = new Uint8Array(40).fill(1)
  const energies = new Float32Array(40).fill(0.006)
  energies.fill(0.09, 12, 15)
  energies.fill(0.1, 19)
  const [which] = refineGraniteWords(words, speech, energies, 0.032, 0, 1.28)
  expect(geometry([which])).toEqual([{ start: 12 * 0.032, end: 15 * 0.032 }])
})

test('unsupported leading padding is removed without cutting a VAD-supported quiet onset', () => {
  const speech = new Uint8Array(80)
  const energies = new Float32Array(80).fill(0.002)
  speech.fill(2, 30, 40)
  energies.fill(0.1, 30, 40)
  expect(
    geometry(refineGraniteWords([{ text: 'ladies', start: 0.2, end: 1.16 }], speech, energies, 0.032, 0, 2)),
  ).toEqual([{ start: 30 * 0.032 - 0.064, end: 40 * 0.032 }])

  speech.fill(1, 6, 30)
  const [quietOnset] = refineGraniteWords([{ text: 'ladies', start: 0.2, end: 1.16 }], speech, energies, 0.032, 0, 2)
  expect(quietOnset.start).toBe(0.2)
})

test('silent gaps stay uncovered and unsupported anchors keep their CTC spans', () => {
  const words = [
    { text: 'one', start: 0.4, end: 0.48 },
    { text: 'two', start: 2.4, end: 2.48 },
  ]
  const speech = new Uint8Array(100)
  speech.fill(1, 12, 20)
  expect(geometry(refineGraniteWords(words, speech, Float32Array.from(speech), 0.032, 0, 3.2))).toEqual([
    { start: 0.4, end: 20 * 0.032 },
    { start: 2.4, end: 2.48 },
  ])
  expect(geometry(refineGraniteWords(words, new Uint8Array(100), new Float32Array(100), 0.032, 0, 3.2))).toEqual(
    geometry(words),
  )
})

test('continuous speech extends an end only up to a letter-based length cap', () => {
  const words = [
    { text: 'one', start: 0.4, end: 0.48 },
    { text: 'two', start: 2.4, end: 2.48 },
  ]
  const speech = new Uint8Array(100).fill(1)
  expect(geometry(refineGraniteWords(words, speech, Float32Array.from(speech), 0.032, 0, 3.2))).toEqual([
    { start: 0.4, end: 0.4 + 0.3 },
    { start: 2.4, end: 2.4 + 0.3 },
  ])
})

test('segment end bounds refinement when acoustic support continues into the next chunk', () => {
  const speech = new Uint8Array(700).fill(1)
  const words = [{ text: 'boundary', start: 19.8, end: 19.92 }]
  expect(geometry(refineGraniteWords(words, speech, Float32Array.from(speech), 0.032, 0, 20))).toEqual([
    { start: 19.8, end: 20 },
  ])
})

test('a word still shorter than its letters suggest bridges its quiet consonants to the end of its speech', () => {
  // Fireside Chat "united states": the spike sits on the /s/ onset, and the quiet /st/ precedes the vowel.
  const speech = new Uint8Array(300).fill(1)
  const energies = new Float32Array(300).fill(0.005)
  energies.fill(0.1, 207, 219)
  energies.fill(0.1, 223, 228)
  const words = [
    { text: 'united', start: 6.626, end: 6.706 },
    { text: 'states', start: 6.946, end: 7.026 },
  ]
  expect(geometry(refineGraniteWords(words, speech, energies, 0.032, 3.2, 7.7))).toEqual([
    { start: 6.626, end: 6.946 },
    { start: 6.946, end: 228 * 0.032 },
  ])
})

test('a long word ends at a pause, and a spike inside that pause starts its word where speech resumes', () => {
  // Fireside Chat "comparatively few who": the "few" spike sits in the pause before its speech.
  const speech = new Uint8Array(700).fill(1)
  const energies = new Float32Array(700).fill(0.005)
  energies.fill(0.08, 579, 582) // "com"
  energies.fill(0.1, 584, 602) // "-paratively", after a stop closure
  energies.fill(0.1, 607, 615) // "few"
  energies.fill(0.1, 616, 622) // "who"
  const words = [
    { text: 'comparatively', start: 18.61, end: 18.69 },
    { text: 'few', start: 19.25, end: 19.33 },
    { text: 'who', start: 19.65, end: 19.73 },
  ]
  const [comparatively, few] = refineGraniteWords(words, speech, energies, 0.032, 10.4, 30.4)
  expect(comparatively.end).toBe(602 * 0.032)
  expect(geometry([few])).toEqual([{ start: 607 * 0.032 - 0.064, end: 19.65 }])
})

test('quiet prefixes and blended speech retain CTC starts instead of internal energy rises', () => {
  const words = [
    { text: 'a', start: 0.4, end: 0.8 },
    { text: 'word', start: 0.9, end: 1.1 },
    { text: 'after', start: 1.6, end: 1.8 },
  ]
  const speech = new Uint8Array(240).fill(1)
  const energies = new Float32Array(240).fill(0.08)
  energies.fill(0.002, 85, 100)
  const starts = (mask: Uint8Array, frameEnergies: Float32Array) =>
    refineGraniteWords(words, mask, frameEnergies, 0.01, 0, 2.4).map((word) => word.start)
  expect(starts(speech, energies)).toEqual([0.4, 0.9, 1.6])
  expect(starts(speech, new Float32Array(240).fill(0.08))).toEqual([0.4, 0.9, 1.6])
  expect(starts(new Uint8Array(240), energies)).toEqual([0.4, 0.9, 1.6])
})

test('frame energies use RMS and include a partial trailing frame', () => {
  expect(Array.from(computeFrameEnergies(Float32Array.from([3, 4, 6]), 2))).toEqual([Math.fround(Math.sqrt(12.5)), 6])
})

test('speech support distinguishes VAD, energy, and frames outside padded segments', () => {
  expect(
    Array.from(
      buildSpeechSupportMask(
        Float32Array.from([0.2, 0, 1]),
        [{ startSample: 0, endSample: 1_024 }],
        Float32Array.from([0, 0.004, 0.02]),
        0.4,
      ),
    ),
  ).toEqual([1, 2, 0])
})

test('word timing uses posterior medians, a 20 ms minimum, and raw-frame fallback', () => {
  const word = { text: 'word', startFrame: 2, endFrame: 3, firstToken: 0, lastToken: 0 }
  const posterior: CtcTokenBoundary = {
    start: { low: 2, median: 3, high: 4 },
    end: { low: 2, median: 3, high: 4 },
  }
  expect(timeGraniteWords([word], [posterior], 1)).toEqual([{ text: 'word', start: 0.24, end: 0.26 }])
  expect(timeGraniteWords([word], null, 1)).toEqual([{ text: 'word', start: 0.16, end: 0.24 }])
})

test('timed words preserve offsets, project rates, clamping, and stable sorting', () => {
  const selectedRange = { startSample: 1_000, endSample: 30_000 }
  expect(
    timedWordsToTranscribedRanges([{ text: 'offset', start: 0, end: 0.08 }], 8_000, 44_100, selectedRange),
  ).toEqual([{ text: 'offset', startSample: 23_050, endSample: 26_578 }])

  expect(
    timedWordsToTranscribedRanges(
      [
        { text: 'later', start: 0.16, end: 0.24 },
        { text: 'short', start: 0, end: 0.08 },
        { text: 'long', start: 0, end: 0.16 },
      ],
      0,
      48_000,
      { startSample: 1_000, endSample: 5_000 },
    ),
  ).toEqual([
    { text: 'short', startSample: 1_000, endSample: 4_840 },
    { text: 'long', startSample: 1_000, endSample: 5_000 },
  ])
})
