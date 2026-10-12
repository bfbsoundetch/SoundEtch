import { expect, test } from 'vitest'
import { formatTranscriptParagraph } from './TranscriptFormatting'

const SAMPLE_RATE = 1000

/** Words 100 samples long; `gaps[j]` (or a single number) separates word j from word j + 1. */
function words(texts: readonly string[], gaps: number | readonly number[] = 0) {
  let cursor = 0
  return texts.map((text, j) => {
    const startSample = cursor
    cursor += 100 + (typeof gaps === 'number' ? gaps : (gaps[j] ?? 0))
    return { text, startSample, endSample: startSample + 100 }
  })
}

function format(texts: readonly string[], gaps?: number | readonly number[]) {
  const formatted = formatTranscriptParagraph(words(texts, gaps), SAMPLE_RATE)
  return { texts: formatted.map((w) => w.text), punctuation: formatted.map((w) => w.punctuation) }
}

test('normalizes a bare O to oh and capitalizes the pronoun and sentence start', () => {
  expect(format(['O', 'i', 'think', 'so'])).toEqual({
    texts: ['Oh', 'I', 'think', 'so'],
    punctuation: ['', '', '', '.'],
  })
})

test('cases the longest dictionary phrase and never splits it with a pause comma', () => {
  expect(format(['we', 'flew', 'to', 'new', 'york', 'city'], [0, 0, 0, 400])).toEqual({
    texts: ['We', 'flew', 'to', 'New', 'York', 'City'],
    punctuation: ['', '', '', '', '', '.'],
  })
})

test('adds a comma at exactly the pause threshold and not one sample below', () => {
  expect(format(['well', 'okay'], 350).punctuation).toEqual([',', '.'])
  expect(format(['well', 'okay'], 349).punctuation).toEqual(['', '.'])
})

test('ends auxiliary-subject openings with a question mark', () => {
  expect(format(['do', 'you', 'know']).punctuation[2]).toBe('?')
  expect(format(['is', 'it', 'true']).punctuation[2]).toBe('?')
  expect(format(['may', 'i', 'go'])).toEqual({ texts: ['May', 'I', 'go'], punctuation: ['', '', '?'] })
})

test('treats do and have with a non-personal subject as imperatives', () => {
  expect(format(['do', 'it', 'now']).punctuation[2]).toBe('.')
  expect(format(['have', 'it', 'your', 'way']).punctuation[3]).toBe('.')
})

test('leaves ambiguous common words lowercase mid-sentence', () => {
  expect(format(['we', 'may', 'march'])).toEqual({ texts: ['We', 'may', 'march'], punctuation: ['', '', '.'] })
})

test('does not double punctuation already present in the text', () => {
  expect(format(['all', 'terrain,', "isn't", 'it?'], 400)).toEqual({
    texts: ['All', 'terrain,', "isn't", 'it?'],
    punctuation: [',', '', ',', ''],
  })
})
