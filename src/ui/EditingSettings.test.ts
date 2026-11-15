import { expect, test } from 'vitest'
import { DEFAULT_EDITING_SETTINGS, normalizeEditingSettings } from './EditingSettings'

test('stored editing settings fall back to defaults, and other tracks only shift with a gap-closing cut', () => {
  expect(normalizeEditingSettings(null)).toEqual(DEFAULT_EDITING_SETTINGS)
  expect(normalizeEditingSettings({ rippleCut: 'yes', otherTracks: 'everything' })).toEqual(DEFAULT_EDITING_SETTINGS)
  expect(normalizeEditingSettings({ rippleCut: false, otherTracks: 'cut' })).toEqual({
    rippleCut: false,
    otherTracks: 'cut',
  })
  expect(normalizeEditingSettings({ rippleCut: true, otherTracks: 'shift' })).toEqual({
    rippleCut: true,
    otherTracks: 'shift',
  })
  expect(normalizeEditingSettings({ rippleCut: false, otherTracks: 'shift' })).toEqual({
    rippleCut: false,
    otherTracks: 'stay',
  })
})
