import { WindowFunction } from '../../../analyzers/FFTWindowFunctions'
import {
  BASE_HOP,
  FFT_SIZE,
  SPECTROGRAM_COLORMAPS,
  SPECTROGRAM_COLORMAP_STOPS,
  TILE_COLUMNS,
  getSpectrogramBandWeight,
  createSpectrogramWindow,
  getSpectrogramFrequencyFraction,
  getSpectrogramMelPoints,
  getSpectrogramScaleTicks,
  getSpectrogramFallbackColor,
  getSpectrogramLevel,
  getSpectrogramTileKeys,
  selectSpectrogramCoverage,
} from './SpectrogramTiling'

test('spectrogram windows use the periodic FFT convention', () => {
  const blackman = createSpectrogramWindow(FFT_SIZE, WindowFunction.BLACKMAN)
  const blackmanHarris = createSpectrogramWindow(FFT_SIZE, WindowFunction.BLACKMAN_HARRIS)
  const hann = createSpectrogramWindow(FFT_SIZE, WindowFunction.HANN)

  expect(blackman).toHaveLength(FFT_SIZE)
  expect(blackman[0]).toBeCloseTo(0)
  expect(blackman[FFT_SIZE / 4]).toBeCloseTo(0.34)
  expect(blackman[FFT_SIZE / 2]).toBeCloseTo(1)

  expect(blackmanHarris[0]).toBeCloseTo(0.00006)
  expect(blackmanHarris[FFT_SIZE / 4]).toBeCloseTo(0.21747)
  expect(blackmanHarris[FFT_SIZE / 2]).toBeCloseTo(1)

  expect(hann[0]).toBeCloseTo(0)
  expect(hann[FFT_SIZE / 4]).toBeCloseTo(0.5)
  expect(hann[FFT_SIZE / 2]).toBeCloseTo(1)
})

test('color schemes use the prototype palettes and matching minimum-dB colors', () => {
  expect(SPECTROGRAM_COLORMAPS).toEqual(['viridis', 'magma', 'inferno', 'grayscale'])
  expect(SPECTROGRAM_COLORMAP_STOPS.viridis[0]).toEqual([0.267, 0.005, 0.329])
  expect(SPECTROGRAM_COLORMAP_STOPS.inferno.at(-1)).toEqual([0.988, 1, 0.643])
  expect(SPECTROGRAM_COLORMAP_STOPS.grayscale).toEqual([
    [0, 0, 0],
    [1, 1, 1],
  ])
  expect(SPECTROGRAM_COLORMAPS.map(getSpectrogramFallbackColor)).toEqual(['#440154', '#000004', '#000004', '#000000'])

  for (const colormap of SPECTROGRAM_COLORMAPS) {
    for (const stop of SPECTROGRAM_COLORMAP_STOPS[colormap]) {
      expect(stop).toHaveLength(3)
      for (const channel of stop) {
        expect(channel).toBeGreaterThanOrEqual(0)
        expect(channel).toBeLessThanOrEqual(1)
      }
    }
  }
})

test('LOD transitions account for device pixels', () => {
  expect(getSpectrogramLevel(511, 1)).toBe(0)
  expect(getSpectrogramLevel(512, 1)).toBe(0)
  expect(getSpectrogramLevel(1024, 1)).toBe(1)
  expect(getSpectrogramLevel(1024, 2)).toBe(0)
  expect(getSpectrogramLevel(2048, 2)).toBe(1)
  expect(getSpectrogramLevel(4096, 3)).toBe(2)
})

test('frequency fractions follow the mel band centers shown at the body edges', () => {
  const frequencyBands = 128
  const sampleRate = 48000
  const melPoints = getSpectrogramMelPoints(frequencyBands, FFT_SIZE, sampleRate)

  expect(getSpectrogramFrequencyFraction(0, frequencyBands, sampleRate)).toBe(0)
  expect(getSpectrogramFrequencyFraction(-5, frequencyBands, sampleRate)).toBe(0)
  expect(getSpectrogramFrequencyFraction(sampleRate / 2, frequencyBands, sampleRate)).toBe(1)

  // The rectangle edges show the centers of the first and last bands, and frequencies map
  // linearly between the band centers in between.
  for (const band of [0, 1, 32, 64, 96, 127]) {
    const centerFrequency = (melPoints[band + 1] / FFT_SIZE) * sampleRate
    expect(getSpectrogramFrequencyFraction(centerFrequency, frequencyBands, sampleRate)).toBeCloseTo(
      band / (frequencyBands - 1),
    )
  }
})

test('scale ticks descend a spaced 1-2-5 ladder within the body', () => {
  const ticks = getSpectrogramScaleTicks(128, 48000, 400, 16)

  expect(ticks[0]).toEqual({ frequency: 20000, label: '20 kHz', fraction: expect.any(Number) })
  expect(ticks.at(-1)!.label).toBe('50 Hz')
  for (let index = 1; index < ticks.length; ++index) {
    expect(ticks[index].frequency).toBeLessThan(ticks[index - 1].frequency)
    expect((ticks[index - 1].fraction - ticks[index].fraction) * 400).toBeGreaterThanOrEqual(16)
  }
  for (const tick of ticks) {
    expect(tick.fraction).toBeGreaterThanOrEqual(0)
    expect(tick.fraction).toBeLessThanOrEqual(1)
  }
})

test('scale ticks thin out and vanish as the body shrinks', () => {
  const tallTicks = getSpectrogramScaleTicks(128, 48000, 400, 16)
  const shortTicks = getSpectrogramScaleTicks(128, 48000, 40, 16)
  expect(shortTicks.length).toBeGreaterThan(0)
  expect(shortTicks.length).toBeLessThan(tallTicks.length)

  expect(getSpectrogramScaleTicks(128, 48000, 0, 16)).toEqual([])
  expect(getSpectrogramScaleTicks(128, 0, 400, 16)).toEqual([])
  expect(getSpectrogramScaleTicks(128, 48000, 400, 0)).toEqual([])
})

test('LOD and tile boundaries follow a configured hop size', () => {
  const hopSize = 256
  const tileSpan = hopSize * TILE_COLUMNS

  expect(getSpectrogramLevel(255, 1, hopSize)).toBe(0)
  expect(getSpectrogramLevel(512, 1, hopSize)).toBe(1)
  expect(getSpectrogramTileKeys(8, tileSpan - 1, tileSpan + 1, 0, 0, hopSize)).toEqual([
    { clipId: 8, level: 0, tileIndex: 0 },
    { clipId: 8, level: 0, tileIndex: 1 },
  ])
  expect(
    selectSpectrogramCoverage([{ clipId: 8, level: 0, tileIndex: 1 }], 8, tileSpan, 2 * tileSpan, 0, hopSize),
  ).toEqual([
    {
      key: { clipId: 8, level: 0, tileIndex: 1 },
      sourceStart: tileSpan,
      sourceEnd: 2 * tileSpan,
    },
  ])
})

test('tile lookup treats source intervals as half-open at tile boundaries', () => {
  const tileSpan = BASE_HOP * TILE_COLUMNS

  expect(getSpectrogramTileKeys(4, 0, tileSpan, 0, 0)).toEqual([{ clipId: 4, level: 0, tileIndex: 0 }])
  expect(getSpectrogramTileKeys(4, tileSpan - 1, tileSpan + 1, 0, 0)).toEqual([
    { clipId: 4, level: 0, tileIndex: 0 },
    { clipId: 4, level: 0, tileIndex: 1 },
  ])
  expect(getSpectrogramTileKeys(4, tileSpan, tileSpan, 0, 1)).toEqual([])
})

test('trimmed source offsets retain exactly one tile of prefetch margin per side', () => {
  const level = 1
  const tileSpan = BASE_HOP * 2 ** level * TILE_COLUMNS

  expect(getSpectrogramTileKeys(17, tileSpan + 123, 2 * tileSpan - 456, level, 1)).toEqual([
    { clipId: 17, level, tileIndex: 0 },
    { clipId: 17, level, tileIndex: 1 },
    { clipId: 17, level, tileIndex: 2 },
  ])
})

test('coverage prefers exact tiles then nearest coarse and fine fallbacks', () => {
  const clipId = 9
  const targetLevel = 1
  const targetTileSpan = BASE_HOP * 2 ** targetLevel * TILE_COLUMNS
  const readyTiles = [
    { clipId, level: 0, tileIndex: 0 },
    { clipId, level: 0, tileIndex: 1 },
    { clipId, level: 0, tileIndex: 4 },
    { clipId, level: 0, tileIndex: 5 },
    { clipId, level: 1, tileIndex: 1 },
    { clipId, level: 2, tileIndex: 0 },
    { clipId: 99, level: 1, tileIndex: 3 },
  ]

  expect(selectSpectrogramCoverage(readyTiles, clipId, 0, 4 * targetTileSpan, targetLevel)).toEqual([
    {
      key: { clipId, level: 2, tileIndex: 0 },
      sourceStart: 0,
      sourceEnd: targetTileSpan,
    },
    {
      key: { clipId, level: 1, tileIndex: 1 },
      sourceStart: targetTileSpan,
      sourceEnd: 2 * targetTileSpan,
    },
    {
      key: { clipId, level: 0, tileIndex: 4 },
      sourceStart: 2 * targetTileSpan,
      sourceEnd: 2.5 * targetTileSpan,
    },
    {
      key: { clipId, level: 0, tileIndex: 5 },
      sourceStart: 2.5 * targetTileSpan,
      sourceEnd: 3 * targetTileSpan,
    },
  ])
})

test('coverage clips selected segments to a trimmed source interval', () => {
  const tileSpan = BASE_HOP * TILE_COLUMNS
  const key = { clipId: 2, level: 0, tileIndex: 3 }

  expect(selectSpectrogramCoverage([key], 2, 3 * tileSpan + 20, 4 * tileSpan - 30, 0)).toEqual([
    {
      key,
      sourceStart: 3 * tileSpan + 20,
      sourceEnd: 4 * tileSpan - 30,
    },
  ])
})

test('mel triangles keep the mel mapping and always integrate neighboring bins', () => {
  for (const sampleRate of [8000, 44100, 48000]) {
    for (const [frequencyBands, fftSize] of [
      [128, 512],
      [256, 512],
      [256, 1024],
      [512, 1024],
      [128, 2048],
      [128, 4096],
    ]) {
      const points = getSpectrogramMelPoints(frequencyBands, fftSize, sampleRate)
      expect(points[0]).toBe(0)
      expect(points[points.length - 1]).toBeCloseTo(fftSize / 2)
      for (let index = 1; index < points.length; index++) {
        expect(points[index]).toBeGreaterThan(points[index - 1])
      }
      for (let band = 0; band < frequencyBands; band++) {
        const firstBin = Math.max(0, Math.floor(points[band] - 0.5))
        const finalBin = Math.min(fftSize / 2 - 1, Math.ceil(points[band + 2] + 0.5))
        let weightSum = 0
        for (let bin = firstBin; bin <= finalBin; bin++) {
          weightSum += getSpectrogramBandWeight(points, band, bin)
        }
        expect(weightSum).toBeGreaterThan(0)
      }
    }
  }
})
