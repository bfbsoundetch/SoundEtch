import { expect, test } from 'vitest'
import { getMatchingMediaTrackIndex } from './MediaTrackMatching'

test('embedded cover artwork does not prevent selecting the real movie track', () => {
  const movie = { index: 0, id: 1 }
  const artwork = { index: 2, id: 0 }
  expect(getMatchingMediaTrackIndex([movie, artwork], movie, [{ id: 1 }], 'video')).toBe(0)
})

test('uses the selected track ID rather than a different parser ordinal', () => {
  const selected = { index: 4, id: 7 }
  const other = { index: 2, id: 3 }
  expect(
    getMatchingMediaTrackIndex([other, selected, { index: 5, id: 0 }], selected, [{ id: 7 }, { id: 3 }], 'video'),
  ).toBe(0)
  expect(getMatchingMediaTrackIndex([selected, other], selected, [{ id: 3 }, { id: 7 }], 'audio')).toBe(1)
})

test('never substitutes a different track when the selected container ID is missing', () => {
  const selected = { index: 0, id: 1 }
  expect(() => getMatchingMediaTrackIndex([selected], selected, [{ id: 2 }], 'video')).toThrow(
    'track (ID 1) is not supported',
  )
})

test('rejects an ambiguous matching ID instead of choosing the first track', () => {
  const selected = { index: 0, id: 1 }
  expect(() => getMatchingMediaTrackIndex([selected], selected, [{ id: 1 }, { id: 1 }], 'video')).toThrow('ambiguous')
})

test('containers without stream IDs retain type-relative ordering when both lists agree', () => {
  const first = { index: 1, id: 0 }
  const selected = { index: 3, id: 0 }
  expect(getMatchingMediaTrackIndex([first, selected], selected, [{ id: 2 }, { id: 4 }], 'audio')).toBe(1)
})

test('anonymous stream count mismatches cannot silently select a different stream', () => {
  const selected = { index: 0, id: 0 }
  expect(() => getMatchingMediaTrackIndex([selected, { index: 2, id: 0 }], selected, [{ id: 1 }], 'video')).toThrow(
    'Cannot reliably identify',
  )
})

test('a selected stream absent from the container inventory is rejected', () => {
  expect(() => getMatchingMediaTrackIndex([{ index: 0, id: 1 }], { index: 2, id: 3 }, [{ id: 1 }], 'video')).toThrow(
    'not found',
  )
})
