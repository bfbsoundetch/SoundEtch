export function importedClipName(filename: string, tags: Record<string, string>): string {
  const title = tags.title?.trim()
  const artist = tags.artist?.trim()

  if (artist && title) {
    return `${artist}: ${title}`
  }
  return title || `File: ${filename}`
}
