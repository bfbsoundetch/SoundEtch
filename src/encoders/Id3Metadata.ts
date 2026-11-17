import type { MediaTags } from './EncoderType'

const standardFrames: Record<string, string> = {
  title: 'TIT2',
  artist: 'TPE1',
  album: 'TALB',
}

function writeSyncsafe(view: DataView, offset: number, size: number) {
  view.setUint32(
    offset,
    ((size & 0x0fe00000) << 3) | ((size & 0x001fc000) << 2) | ((size & 0x00003f80) << 1) | (size & 0x7f),
    false,
  )
}

// ID3v2.4 text frames use UTF-8; TXXX retains arbitrary user-defined keys.
export function serializeId3Tags(tags?: MediaTags): Uint8Array<ArrayBuffer> | undefined {
  if (!tags) return undefined
  const encoder = new TextEncoder()
  const frames = Object.entries(tags)
    .filter(([, value]) => value !== '')
    .map(([key, value]) => {
      const standardKey = key.toLowerCase()
      const id = Object.hasOwn(standardFrames, standardKey) ? standardFrames[standardKey] : 'TXXX'
      const text = encoder.encode(id === 'TXXX' ? `${key}\0${value}` : value)
      return { id, text }
    })
  if (frames.length === 0) return undefined

  const size = frames.reduce((size, frame) => size + 11 + frame.text.length, 0)
  const bytes = new Uint8Array(10 + size)
  const view = new DataView(bytes.buffer)
  bytes.set([0x49, 0x44, 0x33, 4, 0, 0]) // ID3, version 2.4, no flags
  writeSyncsafe(view, 6, size)
  let offset = 10
  for (const { id, text } of frames) {
    for (let i = 0; i < 4; ++i) bytes[offset + i] = id.charCodeAt(i)
    writeSyncsafe(view, offset + 4, 1 + text.length)
    bytes[offset + 10] = 3 // UTF-8
    bytes.set(text, offset + 11)
    offset += 11 + text.length
  }
  return bytes
}
