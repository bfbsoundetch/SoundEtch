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
  expect(geometry(refineGraniteWords(words, speech, Float32Array.from(speech), 0.032, 7))).toEqual([
    { start: 5.554, end: 5.714 },
    { start: 5.714, end: 5.794 },
  ])
})

test('unsupported leading padding is removed without cutting a VAD-supported quiet onset', () => {
  const speech = new Uint8Array(80)
  const energies = new Float32Array(80).fill(0.002)
  speech.fill(2, 30, 40)
  energies.fill(0.1, 30, 40)
  expect(geometry(refineGraniteWords([{ text: 'ladies', start: 0.2, end: 1.16 }], speech, energies, 0.032, 2))).toEqual(
    [{ start: 0.928, end: 1.28 }],
  )

  speech.fill(1, 6, 30)
  expect(geometry(refineGraniteWords([{ text: 'ladies', start: 0.2, end: 1.16 }], speech, energies, 0.032, 2))).toEqual(
    [{ start: 0.2, end: 1.28 }],
  )
})

test('silent gaps stay uncovered and unsupported anchors keep their CTC spans', () => {
  const words = [
    { text: 'one', start: 0.4, end: 0.48 },
    { text: 'two', start: 2.4, end: 2.48 },
  ]
  const speech = new Uint8Array(100)
  speech.fill(1, 12, 20)
  expect(geometry(refineGraniteWords(words, speech, Float32Array.from(speech), 0.032, 3.2))).toEqual([
    { start: 0.4, end: 20 * 0.032 },
    { start: 2.4, end: 2.48 },
  ])
  expect(geometry(refineGraniteWords(words, new Uint8Array(100), new Float32Array(100), 0.032, 3.2))).toEqual(
    geometry(words),
  )
})

test('continuous speech extends ends by no more than 240 ms', () => {
  const words = [
    { text: 'one', start: 0.4, end: 0.48 },
    { text: 'two', start: 2.4, end: 2.48 },
  ]
  const speech = new Uint8Array(100).fill(1)
  expect(geometry(refineGraniteWords(words, speech, Float32Array.from(speech), 0.032, 3.2))).toEqual([
    { start: 0.4, end: 0.72 },
    { start: 2.4, end: 2.48 + 0.24 },
  ])
})

test('segment end bounds refinement when acoustic support continues into the next chunk', () => {
  const speech = new Uint8Array(700).fill(1)
  const words = [{ text: 'boundary', start: 19.8, end: 19.92 }]
  expect(geometry(refineGraniteWords(words, speech, Float32Array.from(speech), 0.032, 20))).toEqual([
    { start: 19.8, end: 20 },
  ])
})

test('competing nearby speech runs keep the selected end bounded', () => {
  const speech = new Uint8Array(100)
  speech.fill(1, 12, 16)
  speech.fill(1, 19, 28)
  expect(
    geometry(
      refineGraniteWords(
        [{ text: 'banking', start: 0.402, end: 0.482 }],
        speech,
        Float32Array.from(speech),
        0.032,
        3.2,
      ),
    ),
  ).toEqual([{ start: 0.402, end: 16 * 0.032 }])
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
  expect(geometry(refineGraniteWords(words, speech, energies, 0.01, 2.4))).toEqual([
    { start: 0.4, end: 0.85 },
    { start: 0.9, end: 1.34 },
    { start: 1.6, end: 2.04 },
  ])
  expect(geometry(refineGraniteWords(words, speech, new Float32Array(240).fill(0.08), 0.01, 2.4))).toEqual([
    { start: 0.4, end: 0.9 },
    { start: 0.9, end: 1.34 },
    { start: 1.6, end: 2.04 },
  ])
  expect(geometry(refineGraniteWords(words, new Uint8Array(240), energies, 0.01, 2.4))).toEqual(geometry(words))
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
