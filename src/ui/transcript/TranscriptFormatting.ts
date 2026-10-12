import { TRANSCRIPT_PROPER_CASING } from './TranscriptProperNouns'

export type TranscriptPunctuation = '' | ',' | '.' | '?'

export interface FormattedTranscriptWord {
  readonly text: string
  readonly punctuation: TranscriptPunctuation
}

interface TimedWord {
  readonly text: string
  readonly startSample: number
  readonly endSample: number
}

/** Pause between words that earns a comma. Below the 600 ms VAD paragraph split. */
export const COMMA_PAUSE_MS = 350

const PROPER_CASING = new Map(TRANSCRIPT_PROPER_CASING.map((cased) => [cased.toLowerCase(), cased]))
const MAX_PHRASE_WORDS = Math.max(...TRANSCRIPT_PROPER_CASING.map((cased) => cased.split(' ').length))
const QUESTION_AUXILIARIES: Record<string, true> = {
  am: true,
  are: true,
  can: true,
  could: true,
  did: true,
  do: true,
  does: true,
  has: true,
  have: true,
  is: true,
  may: true,
  shall: true,
  should: true,
  was: true,
  were: true,
  will: true,
  would: true,
}
const PERSONAL_SUBJECTS: Record<string, true> = { i: true, you: true, we: true, they: true, he: true, she: true }
const QUESTION_SUBJECTS: Record<string, true> = {
  ...PERSONAL_SUBJECTS,
  it: true,
  that: true,
  this: true,
  there: true,
  these: true,
  those: true,
  anyone: true,
  anybody: true,
  someone: true,
  somebody: true,
  everyone: true,
  everybody: true,
}
const TRAILING_PUNCTUATION = /[.,!?;:]$/

/**
 * Display text for one VAD paragraph of raw Granite words: casing, pause commas, and a
 * terminal mark. Returns one entry per input word, in order.
 */
export function formatTranscriptParagraph(words: readonly TimedWord[], sampleRate: number): FormattedTranscriptWord[] {
  const n = words.length
  if (n === 0) return []

  const normalized = words.map((word) => (word.text === 'O' ? 'oh' : word.text))

  const display = new Array<string>(n)
  const insidePhrase = new Array<boolean>(n).fill(false)
  for (let i = 0; i < n;) {
    let matched = 0
    for (let k = Math.min(MAX_PHRASE_WORDS, n - i); k >= 1; k--) {
      const cased = PROPER_CASING.get(normalized.slice(i, i + k).join(' '))
      if (cased === undefined) continue
      let offset = 0
      for (let m = 0; m < k; m++) {
        const length = normalized[i + m].length
        display[i + m] = cased.slice(offset, offset + length)
        offset += length + 1
        if (m < k - 1) insidePhrase[i + m] = true
      }
      matched = k
      break
    }
    if (matched === 0) {
      display[i] = normalized[i]
      matched = 1
    }
    i += matched
  }

  if (/^\p{Ll}/u.test(display[0])) display[0] = display[0][0].toUpperCase() + display[0].slice(1)

  const threshold = Math.round((COMMA_PAUSE_MS / 1000) * sampleRate)
  const punctuation = new Array<TranscriptPunctuation>(n).fill('')
  for (let j = 0; j < n - 1; j++) {
    if (
      words[j + 1].startSample - words[j].endSample >= threshold &&
      !insidePhrase[j] &&
      !TRAILING_PUNCTUATION.test(display[j])
    )
      punctuation[j] = ','
  }
  if (!TRAILING_PUNCTUATION.test(display[n - 1])) {
    const subjects = normalized[0] === 'do' || normalized[0] === 'have' ? PERSONAL_SUBJECTS : QUESTION_SUBJECTS
    const question = n >= 2 && QUESTION_AUXILIARIES[normalized[0]] === true && subjects[normalized[1]] === true
    punctuation[n - 1] = question ? '?' : '.'
  }

  return display.map((text, j) => ({ text, punctuation: punctuation[j] }))
}
