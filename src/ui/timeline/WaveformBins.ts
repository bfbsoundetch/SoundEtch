/** Below this many samples per pixel each sample is drawn as its own line, at its own position. */
export const SAMPLE_DETAIL_SAMPLES_PER_UNIT = 2

export interface WaveformView {
  /** Timeline units (pixels at this zoom) from time 0 to view x 0. */
  readonly translation: number
  readonly width: number
  readonly samplesPerUnit: number
  readonly devicePixelRatio: number
}

/** A clip's source samples to summarize, and where each summary's line goes. */
export interface WaveformBins {
  /** Bin `i` covers source samples [edges[i], edges[i + 1]); empty when nothing is visible. */
  readonly edges: number[]
  /** View x of bin `i`'s line. */
  readonly xs: number[]
}

/**
 * Bins the visible part of the source samples [sourceStart, sourceEnd) of a clip whose source sample 0 sits at
 * timeline sample `clipStart`.
 *
 * Zoomed out, the bins are fixed timeline columns: column k covers timeline samples
 * [floor((k + phase) * samplesPerUnit), floor((k + 1 + phase) * samplesPerUnit)), where phase is the fraction of the
 * translation, so every view pixel is one whole column. Scrolling moves the translation by whole pixels, so a column
 * covers the same samples at every scroll position and its peaks don't change. Each line sits mid-pixel, where a 1px
 * stroke fills exactly its column at any whole device pixel ratio.
 *
 * Zoomed in, each sample is a bin, its line on the device pixel nearest the sample's position.
 */
export function waveformBins(
  view: WaveformView,
  clipStart: number,
  sourceStart: number,
  sourceEnd: number,
): WaveformBins {
  const { translation, width, samplesPerUnit, devicePixelRatio } = view
  const edges: number[] = []
  const xs: number[] = []
  if (sourceStart >= sourceEnd) return { edges, xs }

  if (samplesPerUnit < SAMPLE_DETAIL_SAMPLES_PER_UNIT) {
    const first = Math.max(sourceStart, Math.floor(translation * samplesPerUnit - clipStart))
    const end = Math.min(sourceEnd, Math.ceil((translation + width) * samplesPerUnit - clipStart) + 1)
    for (let sample = first; sample < end; ++sample) {
      edges.push(sample)
      xs.push(Math.round(((clipStart + sample) / samplesPerUnit - translation) * devicePixelRatio) / devicePixelRatio)
    }
    if (first < end) edges.push(end)
    return { edges, xs }
  }

  const firstColumn = Math.floor(translation)
  const phase = translation - firstColumn
  const endColumn = firstColumn + Math.ceil(width)
  // The first source sample in a column; the timeline holds whole samples, but a dragged clip may sit between them.
  const columnStart = (column: number) => Math.ceil(Math.floor((column + phase) * samplesPerUnit) - clipStart)
  // Starts at the column holding sourceStart, or the view's first column when that is further right.
  let column = Math.max(firstColumn, Math.floor((clipStart + sourceStart) / samplesPerUnit - phase))
  while (column > firstColumn && columnStart(column) > sourceStart) --column
  while (column < endColumn && columnStart(column + 1) <= sourceStart) ++column
  for (; column < endColumn && columnStart(column) < sourceEnd; ++column) {
    edges.push(Math.max(columnStart(column), sourceStart))
    xs.push(column - firstColumn + 0.5)
  }
  if (edges.length > 0) edges.push(Math.min(columnStart(column), sourceEnd))
  return { edges, xs }
}
