interface StreamIdentity {
  readonly index: number
  readonly id: number
}

export function getMatchingMediaTrackIndex(
  streams: readonly StreamIdentity[],
  selectedStream: StreamIdentity,
  tracks: readonly { readonly id: number }[],
  mediaType: 'video' | 'audio',
): number {
  const ordinal = streams.findIndex((stream) => stream.index === selectedStream.index)
  if (ordinal < 0) {
    throw new Error(`Selected ${mediaType} stream was not found in the container stream list`)
  }

  const id = streams[ordinal].id
  const hasUniqueId = id > 0 && streams.every((stream, index) => index === ordinal || stream.id !== id)
  if (hasUniqueId) {
    const index = tracks.findIndex((track) => track.id === id)
    if (index < 0) {
      throw new Error(`The selected ${mediaType} track (ID ${id}) is not supported by the media parser`)
    }
    if (tracks.some((track, other) => other !== index && track.id === id)) {
      throw new Error(`The selected ${mediaType} track (ID ${id}) is ambiguous`)
    }
    return index
  }

  // FFmpeg leaves IDs unset for containers such as Matroska. Ordinals are safe only when neither parser omitted a track.
  if (streams.length === tracks.length && tracks[ordinal]) {
    return ordinal
  }
  throw new Error(`Cannot reliably identify the selected ${mediaType} track between media parsers`)
}
