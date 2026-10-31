type Box = {
  type: string
  bytes: Uint8Array
  headerSize: number
}

function readBoxes(bytes: Uint8Array, start = 0): Box[] {
  const boxes: Box[] = []
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let position = start
  while (position < bytes.length) {
    if (position + 8 > bytes.length) throw new Error('Incomplete MP4 box header')
    let size = view.getUint32(position)
    let headerSize = 8
    if (size === 1) {
      if (position + 16 > bytes.length) throw new Error('Incomplete extended MP4 box header')
      const extendedSize = view.getBigUint64(position + 8)
      if (extendedSize > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('MP4 box is too large')
      size = Number(extendedSize)
      headerSize = 16
    } else if (size === 0) {
      size = bytes.length - position
    }
    if (size < headerSize || position + size > bytes.length) throw new Error('Invalid MP4 box size')
    boxes.push({
      type: String.fromCharCode(bytes[position + 4], bytes[position + 5], bytes[position + 6], bytes[position + 7]),
      bytes: bytes.subarray(position, position + size),
      headerSize,
    })
    position += size
  }
  return boxes
}

/** Rebuild only changed containers; untouched child bytes, including chunk offsets, are copied verbatim. */
function rebuildBox(box: Box, children: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const length = box.headerSize + children.reduce((size, child) => size + child.length, 0)
  const bytes = new Uint8Array(length)
  bytes.set(box.bytes.subarray(0, box.headerSize))
  const view = new DataView(bytes.buffer)
  if (box.headerSize === 16) {
    view.setUint32(0, 1)
    view.setBigUint64(8, BigInt(length))
  } else {
    if (length > 0xffffffff) throw new Error('MP4 metadata exceeds its box size field')
    view.setUint32(0, length)
  }
  let position = box.headerSize
  for (const child of children) {
    bytes.set(child, position)
    position += child.length
  }
  return bytes
}

function createBox(type: string, payload: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(8 + payload.length)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, bytes.length)
  for (let i = 0; i < 4; ++i) bytes[4 + i] = type.charCodeAt(i)
  bytes.set(payload, 8)
  return bytes
}

function timescale(box: Box): number {
  const view = new DataView(box.bytes.buffer, box.bytes.byteOffset + box.headerSize, box.bytes.length - box.headerSize)
  const version = view.getUint8(0)
  if (version !== 0 && version !== 1) throw new Error(`Unsupported ${box.type} version`)
  const scale = view.getUint32(version === 1 ? 20 : 12)
  if (scale === 0) throw new Error(`Invalid ${box.type} timescale`)
  return scale
}

/** MP4 timestamps are integral ticks; reject numbers that cannot be represented exactly before writing them. */
function timestampTicks(seconds: number, scale: number): bigint {
  const value = Math.round(seconds * scale)
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('MP4 presentation time is out of range')
  return BigInt(value)
}

function replaceDuration(box: Box, duration: bigint): Uint8Array {
  const payload = box.bytes.subarray(box.headerSize)
  const original = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  const version = original.getUint8(0)
  if (version !== 0 && version !== 1) throw new Error(`Unsupported ${box.type} version`)
  const durationOffset = box.type === 'mvhd' ? 16 : 20
  if (version === 1 || duration <= 0xffffffffn) {
    const copy = payload.slice()
    const view = new DataView(copy.buffer)
    if (version === 1) view.setBigUint64(durationOffset + 8, duration)
    else view.setUint32(durationOffset, Number(duration))
    return rebuildBox(box, [copy])
  }
  // Version 1 widens creation/modification times and duration, retaining flags and every trailing field.
  const promoted = new Uint8Array(payload.length + 12)
  const view = new DataView(promoted.buffer)
  promoted.set(payload.subarray(0, 4))
  promoted[0] = 1
  view.setBigUint64(4, BigInt(original.getUint32(4)))
  view.setBigUint64(12, BigInt(original.getUint32(8)))
  promoted.set(payload.subarray(12, durationOffset), 20)
  view.setBigUint64(durationOffset + 8, duration)
  promoted.set(payload.subarray(durationOffset + 4), durationOffset + 16)
  return rebuildBox(box, [promoted])
}

function createEditList(duration: bigint, mediaTime: bigint): Uint8Array {
  const wide = duration > 0xffffffffn || mediaTime > 0x7fffffffn
  const payload = new Uint8Array(wide ? 28 : 20)
  const view = new DataView(payload.buffer)
  payload[0] = wide ? 1 : 0
  view.setUint32(4, 1)
  if (wide) {
    view.setBigUint64(8, duration)
    view.setBigInt64(16, mediaTime)
  } else {
    view.setUint32(8, Number(duration))
    view.setInt32(12, Number(mediaTime))
  }
  view.setInt16(wide ? 24 : 16, 1)
  return createBox('elst', payload)
}

function replaceTrackWindow(track: Box, duration: bigint, audioDelaySeconds: number): Uint8Array {
  const children = readBoxes(track.bytes, track.headerSize)
  const media = children.find((child) => child.type === 'mdia')
  if (!media) return track.bytes
  const mediaChildren = readBoxes(media.bytes, media.headerSize)
  const handler = mediaChildren.find((child) => child.type === 'hdlr')
  if (!handler) throw new Error('MP4 media handler is missing')
  const offset = handler.headerSize + 8
  const type = String.fromCharCode(...handler.bytes.subarray(offset, offset + 4))
  if (type !== 'vide' && type !== 'soun') return track.bytes
  const header = children.find((child) => child.type === 'tkhd')
  const mediaHeader = mediaChildren.find((child) => child.type === 'mdhd')
  if (!header || !mediaHeader) throw new Error('MP4 track timing headers are missing')
  const mediaScale = timescale(mediaHeader)
  const editList = createEditList(duration, type === 'soun' ? timestampTicks(audioDelaySeconds, mediaScale) : 0n)
  let hasEdits = false
  const rewritten: Uint8Array[] = []
  for (const child of children) {
    if (child.type === 'tkhd') {
      rewritten.push(replaceDuration(child, duration))
    } else if (child.type === 'edts') {
      hasEdits = true
      const edits = readBoxes(child.bytes, child.headerSize)
      let replaced = false
      const editChildren = edits.map((edit) => {
        if (edit.type !== 'elst') return edit.bytes
        replaced = true
        return editList
      })
      if (!replaced) editChildren.push(editList)
      rewritten.push(rebuildBox(child, editChildren))
    } else {
      rewritten.push(child.bytes)
    }
  }
  if (!hasEdits) {
    const index = children.indexOf(header) + 1
    rewritten.splice(index, 0, createBox('edts', editList))
  }
  return rebuildBox(track, rewritten)
}

/**
 * Sets the presentation window of our finalized, nonfragmented MP4's last moov box.
 * The caller replaces that tail box and truncates the file; encoded media and all chunk offsets stay unchanged.
 */
export function setMp4PresentationWindow(
  moov: Uint8Array,
  durationSeconds: number,
  audioDelaySeconds: number,
): Uint8Array<ArrayBuffer> {
  if (
    !Number.isFinite(durationSeconds) ||
    durationSeconds < 0 ||
    !Number.isFinite(audioDelaySeconds) ||
    audioDelaySeconds < 0
  ) {
    throw new Error('MP4 presentation times must be finite and nonnegative')
  }
  const roots = readBoxes(moov)
  if (roots.length !== 1 || roots[0].type !== 'moov') throw new Error('Expected one complete MP4 moov box')
  const movie = roots[0]
  const children = readBoxes(movie.bytes, movie.headerSize)
  const header = children.find((child) => child.type === 'mvhd')
  if (!header) throw new Error('MP4 movie header is missing')
  const duration = timestampTicks(durationSeconds, timescale(header))
  return rebuildBox(
    movie,
    children.map((child) => {
      if (child.type === 'mvhd') return replaceDuration(child, duration)
      if (child.type === 'trak') return replaceTrackWindow(child, duration, audioDelaySeconds)
      return child.bytes
    }),
  )
}
