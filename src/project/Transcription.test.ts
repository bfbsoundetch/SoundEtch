import {
  findTranscriptBoundary,
  moveTranscriptBoundary,
  type TranscribedRange,
  type TranscriptGapKind,
} from './Transcription'

const limits = { minimumSample: 0, maximumSample: 1_000, tolerance: 5 }

function word(text: string, startSample: number, endSample: number): TranscribedRange {
  return { text, startSample, endSample, speechStartSample: 0 }
}

function gap(kind: TranscriptGapKind, startSample: number, endSample: number): TranscribedRange {
  return { text: '', startSample, endSample, kind }
}

test('a shared boundary moves both edges without touching other ranges or the input', () => {
  const ranges = [word('one', 0, 100), word('two', 100, 200), word('three', 200, 300)]
  const original = structuredClone(ranges)

  expect(moveTranscriptBoundary(ranges, 100, 140, limits)).toEqual({
    ranges: [word('one', 0, 140), word('two', 140, 200), word('three', 200, 300)],
    sample: 140,
  })
  expect(ranges).toEqual(original)
})

test('words keep the tolerance of played audio instead of collapsing', () => {
  const ranges = [word('one', 0, 100), word('two', 100, 200)]

  expect(moveTranscriptBoundary(ranges, 100, 500, limits)?.ranges).toEqual([word('one', 0, 195), word('two', 195, 200)])
  expect(moveTranscriptBoundary(ranges, 100, -50, limits)?.ranges).toEqual([word('one', 0, 5), word('two', 5, 200)])
  // Audio trimmed away before the played window does not count toward the word.
  expect(moveTranscriptBoundary(ranges, 100, 0, { ...limits, minimumSample: 50 })?.ranges).toEqual([
    word('one', 0, 55),
    word('two', 55, 200),
  ])
})

test('dragging across a whole gap removes it from either side', () => {
  const ranges = [word('before', 0, 100), gap('silence', 100, 300), word('after', 300, 400)]

  expect(moveTranscriptBoundary(ranges, 100, 297, limits)).toEqual({
    ranges: [word('before', 0, 300), word('after', 300, 400)],
    sample: 300,
  })
  expect(moveTranscriptBoundary(ranges, 300, 0, limits)?.ranges).toEqual([
    word('before', 0, 100),
    word('after', 100, 400),
  ])
})

test('silences left touching by a removed gap merge into one pause', () => {
  const ranges = [gap('silence', 0, 100), gap('untranscribed', 100, 200), gap('silence', 200, 300)]

  expect(moveTranscriptBoundary(ranges, 100, 200, limits)?.ranges).toEqual([gap('silence', 0, 300)])
  expect(moveTranscriptBoundary(ranges, 200, 100, limits)?.ranges).toEqual([gap('silence', 0, 300)])
})

test('an edge beside unlabeled audio moves alone and stops at the next range', () => {
  const ranges = [word('one', 0, 100), word('two', 150, 250)]

  expect(moveTranscriptBoundary(ranges, 100, 120, limits)?.ranges).toEqual([word('one', 0, 120), word('two', 150, 250)])
  expect(moveTranscriptBoundary(ranges, 150, 130, limits)?.ranges).toEqual([word('one', 0, 100), word('two', 130, 250)])
  for (const target of [147, 400]) {
    expect(moveTranscriptBoundary(ranges, 100, target, limits)).toEqual({
      ranges: [word('one', 0, 150), word('two', 150, 250)],
      sample: 150,
    })
  }
})

test('a step away from a limit is not snapped back onto it', () => {
  const ranges = [word('one', 0, 5), word('two', 5, 200)]

  expect(moveTranscriptBoundary(ranges, 5, 8, limits)?.ranges).toEqual([word('one', 0, 8), word('two', 8, 200)])
})

test('a boundary reports the edges it moves and its limits within the played audio', () => {
  const ranges = [word('before', 0, 100), gap('silence', 100, 300), word('after', 300, 400)]

  expect(findTranscriptBoundary(ranges, 100, limits)).toEqual({
    ending: 0,
    starting: 1,
    lowestSample: 5,
    highestSample: 300,
  })
  expect(findTranscriptBoundary(ranges, 300, { ...limits, maximumSample: 350 })).toEqual({
    ending: 1,
    starting: 2,
    lowestSample: 100,
    highestSample: 345,
  })
})

test('edges closer than the tolerance move as one boundary', () => {
  const ranges = [word('one', 0, 100), word('two', 104, 200)]

  expect(moveTranscriptBoundary(ranges, 100, 150, limits)?.ranges).toEqual([word('one', 0, 150), word('two', 150, 200)])
  expect(moveTranscriptBoundary(ranges, 104, 50, limits)?.ranges).toEqual([word('one', 0, 50), word('two', 50, 200)])
  expect(moveTranscriptBoundary([word('one', 0, 100), word('two', 106, 200)], 100, 150, limits)?.ranges).toEqual([
    word('one', 0, 106),
    word('two', 106, 200),
  ])
})

test('ranges outside the played audio neither move nor give way', () => {
  const ranges = [word('trimmed', 0, 100), word('played', 100, 200), word('later', 200, 300)]
  const played = { minimumSample: 100, maximumSample: 200, tolerance: 5 }

  expect(moveTranscriptBoundary(ranges, 100, 150, played)?.ranges).toEqual([
    word('trimmed', 0, 100),
    word('played', 150, 200),
    word('later', 200, 300),
  ])
  expect(moveTranscriptBoundary(ranges, 100, 50, played)).toBeNull()
  expect(moveTranscriptBoundary(ranges, 200, 260, played)).toBeNull()
  expect(moveTranscriptBoundary(ranges, 100, 150, { ...played, minimumSample: 120 })).toBeNull()
})

test('positions that are not a boundary, unchanged moves, and invalid input produce no edit', () => {
  const ranges = [word('one', 0, 100), word('two', 100, 200)]

  expect(moveTranscriptBoundary(ranges, 50, 60, limits)).toBeNull()
  expect(moveTranscriptBoundary(ranges, 100, 100, limits)).toBeNull()
  expect(moveTranscriptBoundary([], 0, 10, limits)).toBeNull()
  for (const target of [NaN, Infinity, 150.5]) {
    expect(moveTranscriptBoundary(ranges, 100, target, limits)).toBeNull()
  }
  expect(moveTranscriptBoundary(ranges, 100, 150, { ...limits, tolerance: -1 })).toBeNull()
})
