import { WindowFunction } from '../../../analyzers/FFTWindowFunctions'
import {
  BASE_HOP,
  FFT_SIZE,
  TILE_COLUMNS,
  createSpectrogramWindow,
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

test('LOD transitions account for device pixels', () => {
  expect(getSpectrogramLevel(511, 1)).toBe(0)
  expect(getSpectrogramLevel(512, 1)).toBe(0)
  expect(getSpectrogramLevel(1024, 1)).toBe(1)
  expect(getSpectrogramLevel(1024, 2)).toBe(0)
  expect(getSpectrogramLevel(2048, 2)).toBe(1)
  expect(getSpectrogramLevel(4096, 3)).toBe(2)
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
    selectSpectrogramCoverage(
      [{ clipId: 8, level: 0, tileIndex: 1 }],
      8,
      tileSpan,
      2 * tileSpan,
      0,
      hopSize,
    ),
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
