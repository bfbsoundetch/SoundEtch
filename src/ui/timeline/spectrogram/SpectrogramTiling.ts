export const FFT_SIZE = 2048
export const BASE_HOP = 512
export const TILE_COLUMNS = 1024
export const HALO_COLUMNS = 1
export const FREQUENCY_BANDS = 128
export const MIN_DB = -96
export const MAX_DB = 0
export const MAX_DPR = 2
export const SOURCE_BUFFER_BYTES = 20 << 20
export const TILE_CACHE_BYTES = 64 << 20

export const BLACKMAN_WINDOW = new Float32Array(
  Array.from({ length: FFT_SIZE }, (_, index) => {
    const phase = (2 * Math.PI * index) / FFT_SIZE
    return 0.42 - 0.5 * Math.cos(phase) + 0.08 * Math.cos(2 * phase)
  }),
)

export interface SpectrogramTileKey {
  clipId: number
  level: number
  tileIndex: number
}

export interface SpectrogramCoverageSegment {
  key: SpectrogramTileKey
  sourceStart: number
  sourceEnd: number
}

export function getSpectrogramLevel(samplesPerCssPixel: number, dpr: number): number {
  const devicePixelRatio = Math.min(MAX_DPR, Math.max(1, dpr))
  const sourceColumnsPerDevicePixel = samplesPerCssPixel / devicePixelRatio / BASE_HOP
  return Math.max(0, Math.floor(Math.log2(sourceColumnsPerDevicePixel)))
}

export function getSpectrogramTileKeys(
  clipId: number,
  sourceStart: number,
  sourceEnd: number,
  level: number,
  marginTiles: number,
): SpectrogramTileKey[] {
  if (sourceEnd <= sourceStart) return []

  const hop = BASE_HOP * 2 ** level
  const tileSourceSpan = hop * TILE_COLUMNS
  const margin = Math.max(0, Math.floor(marginTiles))
  const firstTile = Math.floor(sourceStart / tileSourceSpan) - margin
  const lastTile = Math.ceil(sourceEnd / tileSourceSpan) - 1 + margin
  const keys: SpectrogramTileKey[] = []

  for (let tileIndex = firstTile; tileIndex <= lastTile; tileIndex++) {
    keys.push({ clipId, level, tileIndex })
  }
  return keys
}

export function selectSpectrogramCoverage(
  readyTiles: readonly SpectrogramTileKey[],
  clipId: number,
  sourceStart: number,
  sourceEnd: number,
  targetLevel: number,
): SpectrogramCoverageSegment[] {
  if (sourceEnd <= sourceStart) return []

  const candidates = readyTiles
    .filter((key) => key.clipId === clipId)
    .map((key) => {
      const tileSourceSpan = BASE_HOP * 2 ** key.level * TILE_COLUMNS
      return {
        key,
        sourceStart: key.tileIndex * tileSourceSpan,
        sourceEnd: (key.tileIndex + 1) * tileSourceSpan,
      }
    })
    .filter((candidate) => candidate.sourceStart < sourceEnd && candidate.sourceEnd > sourceStart)

  if (candidates.length === 0) return []

  const boundaries = new Set<number>([sourceStart, sourceEnd])
  for (const candidate of candidates) {
    boundaries.add(Math.max(sourceStart, candidate.sourceStart))
    boundaries.add(Math.min(sourceEnd, candidate.sourceEnd))
  }
  const sortedBoundaries = [...boundaries].sort((left, right) => left - right)
  const segments: SpectrogramCoverageSegment[] = []

  for (let index = 0; index < sortedBoundaries.length - 1; index++) {
    const segmentStart = sortedBoundaries[index]
    const segmentEnd = sortedBoundaries[index + 1]
    if (segmentEnd <= segmentStart) continue

    const selected = candidates
      .filter((candidate) => candidate.sourceStart <= segmentStart && candidate.sourceEnd >= segmentEnd)
      .sort((left, right) => {
        const leftDistance = Math.abs(left.key.level - targetLevel)
        const rightDistance = Math.abs(right.key.level - targetLevel)
        if (leftDistance !== rightDistance) return leftDistance - rightDistance
        if (left.key.level !== right.key.level) return right.key.level - left.key.level
        return left.key.tileIndex - right.key.tileIndex
      })[0]
    if (selected === undefined) continue

    const previous = segments.at(-1)
    if (
      previous !== undefined &&
      previous.sourceEnd === segmentStart &&
      previous.key.clipId === selected.key.clipId &&
      previous.key.level === selected.key.level &&
      previous.key.tileIndex === selected.key.tileIndex
    ) {
      previous.sourceEnd = segmentEnd
    } else {
      segments.push({ key: selected.key, sourceStart: segmentStart, sourceEnd: segmentEnd })
    }
  }

  return segments
}

