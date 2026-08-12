import { describe, expect, test } from 'vitest'
import { importedClipName } from './ImportMetadata'

describe('importedClipName', () => {
  test('uses artist and title when both are available', () => {
    expect(importedClipName('recording.flac', { artist: 'Artist', title: 'Title', album: 'Album' })).toBe(
      'Artist: Title',
    )
  })

  test('uses the title when the artist is unavailable', () => {
    expect(importedClipName('recording.flac', { title: 'Title' })).toBe('Title')
  })

  test('uses the filename when the title is blank or unavailable', () => {
    expect(importedClipName('recording.flac', { artist: 'Artist', title: '  ' })).toBe('File: recording.flac')
  })
})
