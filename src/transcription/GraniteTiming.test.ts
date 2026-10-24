import {
  buildSpeechSupportMask,
  computeFrameEnergies,
  ctcTokenPosteriors,
  graniteLeadingWordOnset,
  refineGraniteWords,
  timedWordsToTranscribedRanges,
  timeGraniteWords,
  graniteWordOnsetFrames,
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

test('a first word in the leading silence starts with the speech where the next word already spikes', () => {
  // Fireside Chat "and so it became": a chunk starts mid-pause; Granite put "and" at the chunk start
  // and the "so" spike where speech resumes, leaving no speech between them.
  const words = [
    { text: 'and', start: 0, end: 0.08 },
    { text: 'so', start: 0.48, end: 0.56 },
  ]
  const speech = new Uint8Array(60).fill(1, 15, 30)
  const [and, so] = refineGraniteWords(words, speech, Float32Array.from(speech), 0.032, 0, 1.92)
  expect(and.start).toBeCloseTo(15 * 0.032, 9)
  expect(so.start).toBeCloseTo(15 * 0.032 + 0.02, 9)
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

test('a first word heard after music the VAD accepts starts at Granite evidence, not the segment start', () => {
  // An intro song runs into "welcome everybody"; Silero and energy both treat the song as speech.
  const words = [
    { text: 'welcome', start: 0, end: 0.08 },
    { text: 'everybody', start: 5.92, end: 6 },
  ]
  const speech = new Uint8Array(250).fill(1)
  const energies = new Float32Array(250).fill(0.1)
  const [unaided] = refineGraniteWords(words, speech, energies, 0.032, 0, 8)
  expect(unaided.start).toBe(0)
  const [welcome, everybody] = refineGraniteWords(words, speech, energies, 0.032, 0, 8, 5.48)
  expect(welcome.start).toBe(5.48)
  expect(welcome.end).toBeLessThanOrEqual(everybody.start)
})

test('energy keeps a first-word onset near Granite evidence and loses one that settled on earlier sound', () => {
  // The segment starts in silence, then music, then "my friends": energy relocation picks the music.
  const words = [
    { text: 'my', start: 10.45, end: 10.53 },
    { text: 'friends', start: 11.36, end: 11.6 },
  ]
  const speech = new Uint8Array(400)
  speech.fill(1, 330, 345)
  speech.fill(1, 352, 365)
  const energies = Float32Array.from(speech)
  const refineMy = (leadingWordOnset: number) =>
    refineGraniteWords(words, speech, energies, 0.032, 10.4, 30.4, leadingWordOnset)[0].start
  expect(refineMy(10.6)).toBeCloseTo(330 * 0.032, 9)
  expect(refineMy(11.28)).toBe(11.28)
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

test('word timing uses posterior medians, earlier prefix onsets, a 20 ms minimum, and raw-frame fallback', () => {
  const word = { text: 'word', startFrame: 2, endFrame: 3, firstToken: 0, lastToken: 0 }
  const posterior: CtcTokenBoundary = {
    start: { low: 2, median: 3, high: 4 },
    end: { low: 2, median: 3, high: 4 },
  }
  expect(timeGraniteWords([word], [posterior], [], 1)).toEqual([{ text: 'word', start: 0.24, end: 0.26 }])
  expect(timeGraniteWords([word], null, [], 1)).toEqual([{ text: 'word', start: 0.16, end: 0.24 }])
  // An onset starts the word mid-frame when earlier than the posterior start, and never delays it.
  expect(timeGraniteWords([word], [posterior], [1], 1)).toEqual([{ text: 'word', start: 0.12, end: 0.24 }])
  expect(timeGraniteWords([word], [posterior], [5], 1)).toEqual([{ text: 'word', start: 0.24, end: 0.26 }])
})

// Non-blank vocabulary log-probabilities, one row per frame; ids absent from a row share the remainder.
function vocabularyLogProbs(rows: readonly Record<number, number>[], vocabularySize: number): Float32Array {
  const logProbs = new Float32Array(rows.length * vocabularySize)
  rows.forEach((row, frame) => {
    const listed = Object.values(row).reduce((sum, probability) => sum + probability, 0)
    const rest = (1 - listed) / (vocabularySize - 1 - Object.keys(row).length)
    for (let id = 1; id < vocabularySize; ++id) {
      logProbs[frame * vocabularySize + id] = Math.log(row[id] ?? rest)
    }
  })
  return logProbs
}

test('a long word starts where its prefix pieces overtake the previous word, not at its late spike', () => {
  // Ids: 1 "Ġthe", 2 "Ġleg", 3 "Ġlegisl", 4 "Ġlegislation".
  const prefixIds: Record<string, number[]> = { the: [1], legislation: [2, 3, 4] }
  const words = [
    { text: 'the', startFrame: 1, endFrame: 2, firstToken: 0, lastToken: 0 },
    { text: 'legislation', startFrame: 7, endFrame: 8, firstToken: 1, lastToken: 1 },
  ]
  const spans = [
    { id: 1, startFrame: 1, endFrame: 2 },
    { id: 4, startFrame: 7, endFrame: 8 },
  ]
  const logProbs = vocabularyLogProbs(
    [
      { 2: 0.5 },
      { 1: 1 },
      { 2: 0.6 },
      { 1: 0.6, 2: 0.3 },
      { 1: 0.3, 2: 0.1, 3: 0.4 },
      { 3: 0.9 },
      { 3: 0.9 },
      { 4: 1 },
    ],
    8,
  )
  // Frames 0–2 precede or still belong to the previous word; frame 3 holds 34%; frame 4 holds 55% against 30%.
  expect(graniteWordOnsetFrames(words, spans, logProbs, 8, (text) => prefixIds[text])).toEqual([undefined, 4])
  // Evidence must lead the spike by three frames.
  const lateSpans = [spans[0], { id: 4, startFrame: 6, endFrame: 7 }]
  const lateWords = [words[0], { ...words[1], startFrame: 6, endFrame: 7 }]
  expect(graniteWordOnsetFrames(lateWords, lateSpans, logProbs, 8, (text) => prefixIds[text])).toEqual([
    undefined,
    undefined,
  ])
})

test('a first word Granite emitted on frame 0 starts where its prefix pieces last show it', () => {
  // An intro song precedes "welcome everybody". Ids: 1 "welcome" (segment-initial piece),
  // 2 "Ġwelcome", 3 "Ġevery", 4 "Ġeverybody".
  const prefixIds: Record<string, number[]> = { welcome: [2], everybody: [3, 4] }
  const spans = [
    { id: 1, startFrame: 0, endFrame: 1 },
    { id: 4, startFrame: 9, endFrame: 10 },
  ]
  const words = [
    { text: 'welcome', startFrame: 0, endFrame: 1, firstToken: 0, lastToken: 0 },
    { text: 'everybody', startFrame: 9, endFrame: 10, firstToken: 1, lastToken: 1 },
  ]
  const logProbs = vocabularyLogProbs(
    [{ 1: 1 }, {}, { 2: 0.5 }, { 3: 0.6 }, {}, { 2: 0.9 }, { 2: 0.8 }, { 2: 0.3, 4: 0.2 }, { 4: 0.5 }, { 4: 1 }],
    6,
  )
  // The song's "Ġwelcome" at frame 2 and "Ġevery" at frame 3 are neither word: "welcome" is heard
  // from frame 5, and "everybody" cannot begin before it.
  const onsets = graniteWordOnsetFrames(words, spans, logProbs, 6, (text) => prefixIds[text])
  expect(onsets).toEqual([5, undefined])
  expect(graniteLeadingWordOnset(words, onsets, 10)).toBe(5.5 * 0.08)

  // Evidence that touches the frame-0 spike is the word itself, spoken from the segment start.
  const spokenAtStart = vocabularyLogProbs([{ 1: 1 }, { 2: 0.9 }, { 2: 0.7 }, {}, { 4: 1 }], 6)
  const nearSpans = [spans[0], { id: 4, startFrame: 4, endFrame: 5 }]
  const nearWords = [words[0], { ...words[1], startFrame: 4, endFrame: 5 }]
  expect(graniteWordOnsetFrames(nearWords, nearSpans, spokenAtStart, 6, (text) => prefixIds[text])).toEqual([
    undefined,
    undefined,
  ])
})

test('prefix onsets skip short words and pieces that spell a prefix of the previous word too', () => {
  // Ids: 1 "Ġi", 2 "Ġis", 3 "Ġissued", 4 "Ġto".
  const prefixIds: Record<string, number[]> = { i: [1], issued: [1, 2, 3], to: [4] }
  const spans = [
    { id: 1, startFrame: 0, endFrame: 1 },
    { id: 3, startFrame: 5, endFrame: 6 },
    { id: 4, startFrame: 10, endFrame: 11 },
  ]
  const words = spans.map((span, index) => ({
    text: ['i', 'issued', 'to'][index],
    startFrame: span.startFrame,
    endFrame: span.endFrame,
    firstToken: index,
    lastToken: index,
  }))
  const logProbs = vocabularyLogProbs(
    [
      { 1: 1 },
      { 1: 0.9 },
      { 1: 0.9 },
      { 1: 0.6, 2: 0.2 },
      { 2: 0.1, 3: 0.2 },
      { 3: 1 },
      { 4: 0.9 },
      { 4: 0.9 },
      { 4: 0.9 },
      { 4: 0.9 },
      { 4: 1 },
    ],
    6,
  )
  // "Ġi" is no evidence for "issued"; "to" is too short despite leading "Ġto" frames.
  expect(graniteWordOnsetFrames(words, spans, logProbs, 6, (text) => prefixIds[text])).toEqual([
    undefined,
    undefined,
    undefined,
  ])
})

test('timed words preserve offsets, project rates, clamping, and stable sorting', () => {
  const selectedRange = { startSample: 1_000, endSample: 30_000 }
  expect(
    timedWordsToTranscribedRanges([{ text: 'offset', start: 0, end: 0.08 }], 8_000, 44_100, selectedRange, []),
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
      [],
    ),
  ).toEqual([
    { text: 'short', startSample: 1_000, endSample: 4_840 },
    { text: 'long', startSample: 1_000, endSample: 5_000 },
  ])
})

test('paragraph membership uses source-rate VAD onsets and assigns padding to the nearest speech region', () => {
  expect(
    timedWordsToTranscribedRanges(
      [
        { text: 'second padding', start: 1.7, end: 1.75 },
        { text: 'first trailing', start: 1, end: 1.05 },
        { text: 'leading', start: 0, end: 0.08 },
        { text: 'second speech', start: 1.9, end: 2 },
      ],
      0,
      48_000,
      { startSample: 48_000, endSample: 624_000 },
      [
        { startSample: 1_600, endSample: 12_800 },
        { startSample: 28_800, endSample: 48_000 },
      ],
    ),
  ).toEqual([
    { text: 'leading', startSample: 48_000, endSample: 51_840, speechStartSample: 52_800 },
    { text: 'first trailing', startSample: 96_000, endSample: 98_400, speechStartSample: 52_800 },
    { text: 'second padding', startSample: 129_600, endSample: 132_000, speechStartSample: 134_400 },
    { text: 'second speech', startSample: 139_200, endSample: 144_000, speechStartSample: 134_400 },
  ])
})

test('processing another 20-second chunk does not start a new speech paragraph', () => {
  const speechRegions = [{ startSample: 0, endSample: 720_000 }]
  const interval = { startSample: 0, endSample: 2_160_000 }
  const words = [{ text: 'continuous', start: 0.2, end: 0.4 }]
  expect([
    ...timedWordsToTranscribedRanges(words, 0, 48_000, interval, speechRegions),
    ...timedWordsToTranscribedRanges(words, 320_000, 48_000, interval, speechRegions),
  ]).toEqual([
    { text: 'continuous', startSample: 9_600, endSample: 19_200, speechStartSample: 0 },
    { text: 'continuous', startSample: 969_600, endSample: 979_200, speechStartSample: 0 },
  ])
})
