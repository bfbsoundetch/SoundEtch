import { expect, test } from 'vitest'
import { waveformBins, type WaveformBins } from './WaveformBins'

const clipStart = 5000
const sourceStart = 70
const sourceEnd = 900_000

function binsAt(translation: number, samplesPerUnit: number, devicePixelRatio: number): WaveformBins {
  return waveformBins({ translation, width: 1000, samplesPerUnit, devicePixelRatio }, clipStart, sourceStart, sourceEnd)
}

/** Each bin's x and end, by the source sample it starts at. */
function byStart({ edges, xs }: WaveformBins) {
  return new Map(xs.map((x, bin) => [edges[bin], { x, end: edges[bin + 1] }]))
}

// The fractional translation is what zooming leaves; scrolling then moves it by whole pixels.
test.each([
  [0.7, 1],
  [0.7, 2],
  [37.3, 1],
  [37.3, 2],
  [300.9, 1],
])('at %s samples per pixel and DPR %s, scrolling moves bins rigidly by whole pixels', (samplesPerUnit, dpr) => {
  const translation = (clipStart + sourceStart) / samplesPerUnit - 15.6
  const before = binsAt(translation, samplesPerUnit, dpr)
  const after = binsAt(translation + 13, samplesPerUnit, dpr)

  for (const { edges, xs } of [before, after]) {
    expect(edges[0]).toBe(sourceStart)
    for (let bin = 1; bin < edges.length; ++bin) expect(edges[bin]).toBeGreaterThan(edges[bin - 1])
    // Lines land on device pixels (each sample) or mid-pixel (each column), so strokes stay crisp.
    for (const x of xs) expect(Number.isInteger(samplesPerUnit < 2 ? x * dpr : x - 0.5)).toBe(true)
  }
  const afterBins = byStart(after)
  // The clip starts in both views, so every bin of the earlier one is still in view.
  expect(before.xs.length).toBeGreaterThan(600)
  for (const [start, { x, end }] of byStart(before)) expect(afterBins.get(start)).toEqual({ x: x - 13, end })
})
