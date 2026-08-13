export function importedClipName(filename: string, tags: Record<string, string>): string {
  const title = getTag(tags, 'title')?.trim()
  const artist = getTag(tags, 'artist')?.trim()

  if (artist && title) {
    return `${artist}: ${title}`
  }
  return title || `File: ${filename}`
}

export function importedTags(
  containerTags: Record<string, string>,
  streams: Array<{ codec_type_string: string; tags: Record<string, string> }>,
): Record<string, string> {
  const audioStreamTags = streams.find((stream) => stream.codec_type_string === 'audio')?.tags ?? {}
  const tags = { ...audioStreamTags }
  const existingKeys = new Map(Object.keys(tags).map((key) => [key.toLowerCase(), key]))

  for (const [key, value] of Object.entries(containerTags)) {
    const streamKey = existingKeys.get(key.toLowerCase())
    if (streamKey && streamKey !== key) {
      delete tags[streamKey]
    }
    tags[key] = value
  }
  return tags
}

function getTag(tags: Record<string, string>, name: string): string | undefined {
  const key = Object.keys(tags).find((candidate) => candidate.toLowerCase() === name)
  return key ? tags[key] : undefined
}
