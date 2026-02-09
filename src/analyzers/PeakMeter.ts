import { RingBuffer } from 'ringbuf.js'

export type SetUpData = {
  inputs: Array<{
    ringBufferArray: SharedArrayBuffer
    peak: Float32Array<SharedArrayBuffer>
  }>
  peakSampleWindow: number
  upsampleFactor: number
}

/**
 * Computes the sinc function (normalized)
 * @param x Input value
 * @returns sinc(x) = sin(πx)/(πx)
 */
function sinc(x: number): number {
  if (x === 0) return 1 // Handle singularity at 0
  const pix = Math.PI * x
  return Math.sin(pix) / pix
}

/**
 * Generates Lanczos interpolation kernels for all phases
 * @param upsampleFactor Upsampling factor (must be integer > 1)
 * @param windowSize Lanczos window size (typically 2 or 3)
 * @returns Array of kernels for each phase
 */
function generateLanczosKernels(upsampleFactor: number, windowSize: number): number[][] {
  if (upsampleFactor <= 1 || !Number.isInteger(upsampleFactor)) {
    throw new Error('Upsample factor must be integer > 1')
  }
  if (windowSize <= 0) {
    throw new Error('Window size must be positive')
  }

  const kernels: number[][] = []
  const kernelSize = 2 * windowSize

  // Generate kernel for each phase (skip phase 0 which is original samples)
  for (let phase = 1; phase < upsampleFactor; phase++) {
    const t = phase / upsampleFactor
    const kernel = new Array(kernelSize)

    // Calculate coefficients for this phase
    for (let i = 0; i < kernelSize; i++) {
      const x = i - windowSize + 1 - t // Center around interpolation point
      kernel[i] = sinc(x) * sinc(x / windowSize)
    }

    kernels.push(kernel)
  }

  return kernels
}

function* clampInput(numberIterable: Iterable<number>, a: number) {
  let isFirst = true
  let x: number = 0
  for (x of numberIterable) {
    if (isFirst) {
      isFirst = false
      for (let i = 0; i < a - 1; ++i) {
        yield x
      }
    }
    yield x
  }
  for (let i = 0; i < a; ++i) {
    yield x
  }
}

export function* lanczosInterpolate(input: Iterable<number>, upsampleFactor: number, windowSize: number = 3) {
  const coef = generateLanczosKernels(upsampleFactor, windowSize)
  const weights = new Array<number>(upsampleFactor - 1).fill(0)
  for (let j = 0; j < upsampleFactor - 1; ++j) {
    for (let i = 0; i < 2 * windowSize; ++i) {
      weights[j] += coef[j][i]
    }
  }

  const surroundingValues = new Array<number>(2 * windowSize).fill(0)
  let index = 0
  for (const x of clampInput(input, windowSize)) {
    surroundingValues[(index + windowSize - 1) % (2 * windowSize)] = x
    yield surroundingValues[index]
    for (let j = 0; j < upsampleFactor - 1; ++j) {
      let y = 0
      for (let i = 0; i < 2 * windowSize; ++i) {
        // a + 1 == 2 * a - (a - 1)
        y += surroundingValues[(i + index + windowSize + 1) % (2 * windowSize)] * coef[j][i]
      }
      yield y / weights[j]
    }
    index = (index + 1) % (2 * windowSize)
  }
}

export async function* iirFilter(
  input: AsyncIterable<number>,
  b: Array<number>, // numerators (feedforward)
  a: Array<number>, // denominators (feedback)
) {
  // Normalize coefficients if a[0] != 1
  if (a[0] != 1) {
    b = b.map((bi) => bi / a[0])
    a = a.map((ai) => ai / a[0])
  }

  const xBuffer = new Array<number>(b.length).fill(0)
  const yBuffer = new Array<number>(a.length).fill(0)
  let xPos = 0
  let yPos = 0

  for await (const x of input) {
    xBuffer[xPos] = x

    // Compute output
    let y = 0
    // Feedforward (b terms)
    for (let i = 0; i < b.length; i++) {
      y += b[i] * xBuffer[(xPos - i + xBuffer.length) % xBuffer.length]
    }
    // Feedback (a terms - skip a[0] which is 1 after normalization)
    for (let i = 1; i < a.length; i++) {
      y -= a[i] * yBuffer[(yPos - i + yBuffer.length) % yBuffer.length]
    }

    // Store output
    yBuffer[yPos] = y
    xPos = (xPos + 1) % xBuffer.length
    yPos = (yPos + 1) % yBuffer.length

    yield y
  }
}

export function onmessageHandler(data: SetUpData) {
  const windowSize = data.peakSampleWindow ?? 1024

  const routines = data.inputs.map((input) => {
    const ringBuffer = new RingBuffer(input.ringBufferArray, Float32Array)
    const inputGenerator = function* () {
      const buf = new Float32Array(windowSize)
      while (ringBuffer.availableRead()) {
        const poppedCount = ringBuffer.pop(buf)
        yield* buf.slice(0, poppedCount)
      }
    }
    const upsampleGenerator = lanczosInterpolate(inputGenerator(), data.upsampleFactor ?? 8)
    return { generator: upsampleGenerator, peak: input.peak }
  })
  while (routines.length) {
    for (const routine of routines) {
      let peak = 0
      for (let i = 0; i < windowSize * data.upsampleFactor; ++i) {
        const next = routine.generator.next()
        if (next.done) {
          routines.splice(routines.indexOf(routine), 1)
          break
        }
        peak = Math.max(Math.abs(next.value), peak)
      }
      routine.peak[0] = peak
    }
  }
}

globalThis.onmessage = (e) => onmessageHandler(e.data)
