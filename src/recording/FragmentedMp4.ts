/**
 * Byte length of the playable prefix of a fragmented MP4 whose writing may have stopped mid-box: through the last
 * complete mdat that follows a moof (after the moov), or through a complete closing mfra. 0 when no fragment is complete.
 */
export function getPlayableFragmentedMp4Length(
  size: number,
  read: (position: number, length: number) => Uint8Array,
): number {
  let position = 0
  let movie = false
  let fragment = false
  let playable = 0
  while (position + 8 <= size) {
    // Shorter than 16 bytes near the end of the file.
    const header = read(position, 16)
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength)
    let boxSize = view.getUint32(0)
    if (boxSize == 1) {
      if (header.byteLength < 16) break
      boxSize = Number(view.getBigUint64(8))
    }
    // Also stops at size 0 ("to the end of the file"), which the muxer never writes.
    if (boxSize < 8 || position + boxSize > size) break
    const end = position + boxSize
    const type = String.fromCharCode(header[4], header[5], header[6], header[7])
    if (type == 'moov') {
      movie = true
    } else if (type == 'moof') {
      fragment = true
    } else if (type == 'mdat' && movie && fragment) {
      playable = end
      fragment = false
    } else if (type == 'mfra' && playable > 0) {
      playable = end
    }
    position = end
  }
  return playable
}
