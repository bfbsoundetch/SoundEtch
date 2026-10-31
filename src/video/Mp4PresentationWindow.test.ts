import { expect, test } from 'vitest'
import { setMp4PresentationWindow } from './Mp4PresentationWindow'

function concatenate(parts: readonly Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((length, part) => length + part.length, 0))
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.length
  }
  return bytes
}

function box(type: string, payload: Uint8Array, extended = false): Uint8Array {
  const header = new Uint8Array(extended ? 16 : 8)
  const view = new DataView(header.buffer)
  view.setUint32(0, extended ? 1 : header.length + payload.length)
  if (extended) view.setBigUint64(8, BigInt(header.length + payload.length))
  for (let i = 0; i < 4; ++i) header[4 + i] = type.charCodeAt(i)
  return concatenate([header, payload])
}

function timingHeader(type: 'mvhd' | 'tkhd' | 'mdhd', version: number, scale: number, duration: bigint): Uint8Array {
  const baseLength = type === 'mvhd' ? 100 : type === 'tkhd' ? 84 : 24
  const payload = new Uint8Array(baseLength + (version === 1 ? 12 : 0))
  const view = new DataView(payload.buffer)
  payload[0] = version
  payload[3] = type === 'tkhd' ? 3 : 0
  if (version === 1) {
    view.setBigUint64(4, 0x100000002n)
    view.setBigUint64(12, 0x200000003n)
  } else {
    view.setUint32(4, 123)
    view.setUint32(8, 456)
  }
  const offset = version === 1 ? 20 : 12
  view.setUint32(offset, type === 'tkhd' ? 7 : scale)
  const durationOffset = offset + (type === 'tkhd' ? 8 : 4)
  if (version === 1) view.setBigUint64(durationOffset, duration)
  else view.setUint32(durationOffset, Number(duration))
  // Mark untouched fields after duration, such as matrix, volume, dimensions and language.
  payload.fill(0x5a, durationOffset + (version === 1 ? 8 : 4))
  return box(type, payload)
}

function handler(type: string): Uint8Array {
  const payload = new Uint8Array(25)
  for (let i = 0; i < 4; ++i) payload[8 + i] = type.charCodeAt(i)
  return box('hdlr', payload)
}

const preserved = box('free', new Uint8Array([18, 41, 99, 211]))
const offsets = new Uint8Array(16)
const offsetView = new DataView(offsets.buffer)
offsetView.setUint32(4, 2)
offsetView.setUint32(8, 48)
offsetView.setUint32(12, 0xfedcba98)
const chunkOffsets = box('stco', offsets)

function track(type: string, version: number, existingEdits: boolean, audioScale = 48000): Uint8Array {
  const scale = type === 'soun' ? audioScale : 90000
  const duration = type === 'soun' ? 195584n : 360000n
  const parts = [timingHeader('tkhd', version, 0, 4075n)]
  if (existingEdits) {
    const oldEdit = new Uint8Array(20)
    const view = new DataView(oldEdit.buffer)
    view.setUint32(4, 1)
    view.setUint32(8, 4075)
    view.setInt32(12, 1234)
    view.setInt16(16, 1)
    parts.push(box('edts', concatenate([preserved, box('elst', oldEdit)])))
  }
  parts.push(
    box(
      'mdia',
      concatenate([
        timingHeader('mdhd', version, scale, duration),
        handler(type),
        box('minf', box('stbl', concatenate([preserved, chunkOffsets]))),
      ]),
    ),
  )
  return box('trak', concatenate(parts))
}

function movie(version: number, extended = false, movieScale = 1000, audioScale = 48000): Uint8Array {
  // Audio deliberately precedes video: edit handling must follow hdlr, not track order.
  return box(
    'moov',
    concatenate([
      timingHeader('mvhd', version, movieScale, 4075n),
      preserved,
      track('soun', version, true, audioScale),
      track('vide', version, false),
      track('meta', version, false),
    ]),
    extended,
  )
}

type ParsedBox = { type: string; bytes: Uint8Array; payload: DataView; headerSize: number }

/** An independent box walk also asserts that every rewritten parent size exactly covers its children. */
function children(bytes: Uint8Array, start = 0): ParsedBox[] {
  const result: ParsedBox[] = []
  let offset = start
  while (offset < bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.length - offset)
    const extended = view.getUint32(0) === 1
    const length = extended ? Number(view.getBigUint64(8)) : view.getUint32(0)
    const headerSize = extended ? 16 : 8
    expect(length).toBeGreaterThanOrEqual(headerSize)
    expect(offset + length).toBeLessThanOrEqual(bytes.length)
    const child = bytes.subarray(offset, offset + length)
    result.push({
      type: String.fromCharCode(...child.subarray(4, 8)),
      bytes: child,
      payload: new DataView(child.buffer, child.byteOffset + headerSize, child.length - headerSize),
      headerSize,
    })
    offset += length
  }
  expect(offset).toBe(bytes.length)
  return result
}

function find(parent: ParsedBox, ...path: string[]): ParsedBox {
  let current = parent
  for (const type of path) {
    const next = children(current.bytes, current.headerSize).find((child) => child.type === type)
    if (!next) throw new Error(`Missing test box ${type}`)
    current = next
  }
  return current
}

function duration(header: ParsedBox): bigint {
  const offset = header.type === 'tkhd' ? 20 : 16
  return header.payload.getUint8(0) === 1
    ? header.payload.getBigUint64(offset + 8)
    : BigInt(header.payload.getUint32(offset))
}

function edit(track: ParsedBox): {
  version: number
  duration: bigint
  mediaTime: bigint
  rate: number
  fraction: number
} {
  const view = find(track, 'edts', 'elst').payload
  const version = view.getUint8(0)
  expect(view.getUint32(4)).toBe(1)
  return {
    version,
    duration: version === 1 ? view.getBigUint64(8) : BigInt(view.getUint32(8)),
    mediaTime: version === 1 ? view.getBigInt64(16) : BigInt(view.getInt32(12)),
    rate: view.getInt16(version === 1 ? 24 : 16),
    fraction: view.getInt16(version === 1 ? 26 : 18),
  }
}

test.each([0, 1])(
  'sets the exact presentation window with version %i headers without changing encoded media',
  (version) => {
    const original = movie(version)
    const originalCopy = original.slice()
    const rewritten = setMp4PresentationWindow(original, 4, 2112 / 48000)
    const root = children(rewritten)[0]
    const tracks = children(root.bytes, root.headerSize).filter((child) => child.type === 'trak')
    expect(duration(find(root, 'mvhd'))).toBe(4000n)
    expect(duration(find(tracks[0], 'tkhd'))).toBe(4000n)
    expect(duration(find(tracks[1], 'tkhd'))).toBe(4000n)
    expect(edit(tracks[0])).toEqual({ version: 0, duration: 4000n, mediaTime: 2112n, rate: 1, fraction: 0 })
    expect(edit(tracks[1])).toEqual({ version: 0, duration: 4000n, mediaTime: 0n, rate: 1, fraction: 0 })
    expect(duration(find(tracks[0], 'mdia', 'mdhd'))).toBe(195584n)
    expect(duration(find(tracks[1], 'mdia', 'mdhd'))).toBe(360000n)
    const oldRoot = children(original)[0]
    const oldTracks = children(oldRoot.bytes, oldRoot.headerSize).filter((child) => child.type === 'trak')
    for (let i = 0; i < 2; ++i) {
      expect(find(tracks[i], 'mdia').bytes).toEqual(find(oldTracks[i], 'mdia').bytes)
      expect(find(tracks[i], 'mdia', 'minf', 'stbl', 'stco').bytes).toEqual(chunkOffsets)
      expect(find(tracks[i], 'tkhd').payload.getUint8(0)).toBe(version)
    }
    expect(find(tracks[0], 'edts', 'free').bytes).toEqual(preserved)
    expect(tracks[2].bytes).toEqual(oldTracks[2].bytes)
    expect(find(root, 'free').bytes).toEqual(preserved)
    expect(original).toEqual(originalCopy)
  },
)

test('rounds the requested window in the movie timescale and delay in the audio timescale', () => {
  const root = children(setMp4PresentationWindow(movie(0), 1.2346, 0.012345))[0]
  const tracks = children(root.bytes, root.headerSize).filter((child) => child.type === 'trak')
  expect(duration(find(root, 'mvhd'))).toBe(1235n)
  expect(edit(tracks[0]).duration).toBe(1235n)
  expect(edit(tracks[0]).mediaTime).toBe(593n)
  expect(edit(tracks[1]).mediaTime).toBe(0n)
})

test.each([0, 1])(
  'writes long duration and media time in version 1 without losing version %i header fields',
  (version) => {
    const original = movie(version, true)
    const rewritten = setMp4PresentationWindow(original, 5_000_000, 50_000)
    const root = children(rewritten)[0]
    const tracks = children(root.bytes, root.headerSize).filter((child) => child.type === 'trak')
    expect(root.headerSize).toBe(16)
    expect(new DataView(rewritten.buffer).getBigUint64(8)).toBe(BigInt(rewritten.length))
    const headers = [find(root, 'mvhd'), find(tracks[0], 'tkhd'), find(tracks[1], 'tkhd')]
    for (const header of headers) {
      expect(header.payload.getUint8(0)).toBe(1)
      expect(header.payload.getBigUint64(4)).toBe(version === 1 ? 0x100000002n : 123n)
      expect(header.payload.getBigUint64(12)).toBe(version === 1 ? 0x200000003n : 456n)
      expect(duration(header)).toBe(5_000_000_000n)
      const tailOffset = header.type === 'mvhd' ? 32 : 36
      expect(
        new Uint8Array(
          header.payload.buffer,
          header.payload.byteOffset + tailOffset,
          header.payload.byteLength - tailOffset,
        ),
      ).toEqual(new Uint8Array(header.payload.byteLength - tailOffset).fill(0x5a))
    }
    expect(find(tracks[0], 'tkhd').payload.getUint32(20)).toBe(7)
    expect(find(tracks[0], 'tkhd').payload.getUint8(3)).toBe(3)
    expect(edit(tracks[0])).toEqual({
      version: 1,
      duration: 5_000_000_000n,
      mediaTime: 2_400_000_000n,
      rate: 1,
      fraction: 0,
    })
    expect(edit(tracks[1])).toEqual({ version: 1, duration: 5_000_000_000n, mediaTime: 0n, rate: 1, fraction: 0 })
    expect(find(tracks[0], 'mdia', 'minf', 'stbl', 'stco').bytes).toEqual(chunkOffsets)
  },
)

test('uses a version 1 audio edit when only media time exceeds signed 32-bit range', () => {
  const root = children(setMp4PresentationWindow(movie(0), 1, 50_000))[0]
  const tracks = children(root.bytes, root.headerSize).filter((child) => child.type === 'trak')
  expect(find(root, 'mvhd').payload.getUint8(0)).toBe(0)
  expect(edit(tracks[0])).toEqual({ version: 1, duration: 1000n, mediaTime: 2_400_000_000n, rate: 1, fraction: 0 })
  expect(edit(tracks[1]).version).toBe(0)
})

test('uses the stored movie and audio timescales rather than export preset constants', () => {
  const root = children(setMp4PresentationWindow(movie(1, false, 90000, 44100), 1.2346, 0.012345))[0]
  const tracks = children(root.bytes, root.headerSize).filter((child) => child.type === 'trak')
  expect(duration(find(root, 'mvhd'))).toBe(111114n)
  expect(duration(find(tracks[0], 'tkhd'))).toBe(111114n)
  expect(edit(tracks[0]).duration).toBe(111114n)
  expect(edit(tracks[0]).mediaTime).toBe(544n)
  expect(edit(tracks[1]).duration).toBe(111114n)
})

test('replaces an existing presentation edit instead of accumulating edits on repeated rewrites', () => {
  const first = setMp4PresentationWindow(movie(0), 4, 2112 / 48000)
  const second = setMp4PresentationWindow(first, 3, 1024 / 48000)
  const root = children(second)[0]
  const tracks = children(root.bytes, root.headerSize).filter((child) => child.type === 'trak')
  for (const track of tracks.slice(0, 2)) {
    const edits = children(track.bytes, track.headerSize).filter((child) => child.type === 'edts')
    expect(edits).toHaveLength(1)
    expect(children(edits[0].bytes, edits[0].headerSize).filter((child) => child.type === 'elst')).toHaveLength(1)
    expect(edit(track).duration).toBe(3000n)
  }
  expect(edit(tracks[0]).mediaTime).toBe(1024n)
  expect(first).toEqual(setMp4PresentationWindow(movie(0), 4, 2112 / 48000))
})
