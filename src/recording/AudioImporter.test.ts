import { describe, expect, test } from 'vitest'
import { importedClipName, importedTags } from './ImportMetadata'

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

  test('reads artist and title case-insensitively', () => {
    expect(importedClipName('recording.ogg', { ARTIST: 'Artist', TITLE: 'Title' })).toBe('Artist: Title')
  })
})

describe('importedTags', () => {
  test('includes tags from the first audio stream', () => {
    expect(
      importedTags({}, [
        { codec_type_string: 'video', tags: { title: 'Video title' } },
        { codec_type_string: 'audio', tags: { ARTIST: 'Artist', TITLE: 'Title' } },
      ]),
    ).toEqual({ ARTIST: 'Artist', TITLE: 'Title' })
  })

  test('container tags override stream tags case-insensitively', () => {
    expect(
      importedTags(
        { artist: 'Container artist', album: 'Album' },
        [{ codec_type_string: 'audio', tags: { ARTIST: 'Stream artist', TITLE: 'Title' } }],
      ),
    ).toEqual({ artist: 'Container artist', album: 'Album', TITLE: 'Title' })
  })
})
