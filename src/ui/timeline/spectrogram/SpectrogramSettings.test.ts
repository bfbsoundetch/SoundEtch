import { WindowFunction } from '../../../analyzers/FFTWindowFunctions'
import { DEFAULT_SPECTROGRAM_SETTINGS, normalizeSpectrogramSettings } from './SpectrogramSettings'

test('spectrogram settings preserve the established analysis defaults', () => {
  expect(DEFAULT_SPECTROGRAM_SETTINGS).toEqual({
    fftSize: 2048,
    hopSize: 512,
    frequencyBands: 128,
    windowFunction: WindowFunction.BLACKMAN,
    colormap: 'viridis',
    minDb: -96,
  })
  expect(Object.isFrozen(DEFAULT_SPECTROGRAM_SETTINGS)).toBe(true)
})

test('spectrogram settings accept supported values', () => {
  expect(
    normalizeSpectrogramSettings({
      fftSize: 4096,
      hopSize: 128,
      frequencyBands: 256,
      windowFunction: WindowFunction.BLACKMAN_HARRIS,
      colormap: 'inferno',
      minDb: -120,
    }),
  ).toEqual({
    fftSize: 4096,
    hopSize: 128,
    frequencyBands: 256,
    windowFunction: WindowFunction.BLACKMAN_HARRIS,
    colormap: 'inferno',
    minDb: -120,
  })
})

test('spectrogram settings reject unsupported analysis dimensions', () => {
  expect(
    normalizeSpectrogramSettings({
      fftSize: 1000,
      hopSize: 300,
      frequencyBands: 100,
      windowFunction: WindowFunction.RECTANGLE,
      colormap: 'rainbow',
      minDb: Number.NaN,
    }),
  ).toEqual(DEFAULT_SPECTROGRAM_SETTINGS)
})

test('spectrogram settings constrain dependent and minimum-dB values', () => {
  expect(
    normalizeSpectrogramSettings({
      fftSize: 512,
      hopSize: 1024,
      frequencyBands: 256,
      windowFunction: WindowFunction.HANN,
      minDb: -200.4,
      colormap: 'grayscale',
    }),
  ).toEqual({
    fftSize: 512,
    hopSize: 512,
    frequencyBands: 256,
    windowFunction: WindowFunction.HANN,
    colormap: 'grayscale',
    minDb: -160,
  })

  expect(normalizeSpectrogramSettings({ minDb: -0.6 }).minDb).toBe(-1)
})
