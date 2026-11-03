import { Summary } from './Summary'

const sampleDataLength = 1024
globalThis.postMessage = () => {}

test('interleaved test', async () => {
  const channelCount = 2
  const summary = new Summary(channelCount, 8)
  const sampleData = new Float32Array(sampleDataLength * channelCount)
  for (let i = 0; i < sampleData.length; ++i) {
    if (i % channelCount == 0) {
      sampleData[i] = 0.8 * Math.sin((Math.PI * i) / 32.0)
    }
  }

  summary.summarizeInterleavedData(sampleData, sampleDataLength * channelCount)
  const bothChannelSummary = summary.getSummaryOfRange(0, sampleDataLength, Summary.SAMPLES_PER_SUMMARY)
  const firstChannelSummary = bothChannelSummary[0]
  const secondChannelSummary = bothChannelSummary[1]

  console.log(firstChannelSummary + ' ' + secondChannelSummary)

  expect(firstChannelSummary[0]).toBeCloseTo(0.8, 4)
  expect(firstChannelSummary[1]).toBeCloseTo(-0.8, 4)
  expect(firstChannelSummary[2]).toBeCloseTo(0.8, 4)
  expect(firstChannelSummary[3]).toBeCloseTo(-0.8, 4)
  expect(firstChannelSummary[4]).toBeCloseTo(0.8, 4)
  expect(firstChannelSummary[5]).toBeCloseTo(-0.8, 4)
  expect(firstChannelSummary[6]).toBeCloseTo(0.8, 4)
  expect(firstChannelSummary[7]).toBeCloseTo(-0.8, 4)

  expect(secondChannelSummary[0]).toBe(0)
  expect(secondChannelSummary[1]).toBe(0)
  expect(secondChannelSummary[2]).toBe(0)
  expect(secondChannelSummary[3]).toBe(0)
  expect(secondChannelSummary[4]).toBe(0)
  expect(secondChannelSummary[5]).toBe(0)
  expect(secondChannelSummary[6]).toBe(0)
  expect(secondChannelSummary[7]).toBe(0)
})

test('interleaved multiple input test', async () => {
  const channelCount = 2
  const summary = new Summary(channelCount, 8)
  const sampleData = new Float32Array(sampleDataLength * channelCount)
  for (let i = 0; i < sampleData.length; ++i) {
    if (i % channelCount == 0) {
      sampleData[i] = 0.8 * Math.sin((Math.PI * i) / 32.0)
    }
    if (i % 6 == 5) {
      summary.summarizeInterleavedData(sampleData.slice(i - 5, i + 1), 6)
    }
    if (i == sampleData.length - 1) {
      const lastIndex = Math.floor(sampleData.length / 6) * 6
      summary.summarizeInterleavedData(sampleData.slice(lastIndex, i + 1), 6)
    }
  }

  const bothChannelSummary = summary.getSummaryOfRange(0, sampleDataLength, Summary.SAMPLES_PER_SUMMARY)
  const firstChannelSummary = bothChannelSummary[0]
  const secondChannelSummary = bothChannelSummary[1]

  console.log(firstChannelSummary + ' ' + secondChannelSummary)

  expect(firstChannelSummary[0]).toBeCloseTo(0.8, 4)
  expect(firstChannelSummary[1]).toBeCloseTo(-0.8, 4)
  expect(firstChannelSummary[2]).toBeCloseTo(0.8, 4)
  expect(firstChannelSummary[3]).toBeCloseTo(-0.8, 4)
  expect(firstChannelSummary[4]).toBeCloseTo(0.8, 4)
  expect(firstChannelSummary[5]).toBeCloseTo(-0.8, 4)
  expect(firstChannelSummary[6]).toBeCloseTo(0.8, 4)
  expect(firstChannelSummary[7]).toBeCloseTo(-0.8, 4)

  expect(secondChannelSummary[0]).toBe(0)
  expect(secondChannelSummary[1]).toBe(0)
  expect(secondChannelSummary[2]).toBe(0)
  expect(secondChannelSummary[3]).toBe(0)
  expect(secondChannelSummary[4]).toBe(0)
  expect(secondChannelSummary[5]).toBe(0)
  expect(secondChannelSummary[6]).toBe(0)
  expect(secondChannelSummary[7]).toBe(0)
})

test('separate channel multiple input test', async () => {
  const channelCount = 2
  const summary = new Summary(channelCount, 8)
  const channel0 = new Float32Array(sampleDataLength),
    channel1 = new Float32Array(sampleDataLength)
  for (let i = 0; i < sampleDataLength; ++i) {
    channel0[i] = 0.8 * Math.sin((Math.PI * i) / 32.0)
    channel1[i] = 0.4 * Math.sin((Math.PI * i) / 32.0)
    if (i % 6 == 5) {
      summary.summarizeSeparateChannelData([channel0.slice(i - 5, i + 1), channel1.slice(i - 5, i + 1)], 6)
    }
    if (i == sampleDataLength - 1) {
      const lastIndex = Math.floor(sampleDataLength / 6) * 6
      summary.summarizeSeparateChannelData([channel0.slice(lastIndex, i + 1), channel1.slice(lastIndex, i + 1)], 6)
    }
  }

  const bothChannelSummary = summary.getSummaryOfRange(0, sampleDataLength, Summary.SAMPLES_PER_SUMMARY)
  const firstChannelSummary = bothChannelSummary[0]
  const secondChannelSummary = bothChannelSummary[1]

  console.log(firstChannelSummary + ' ' + secondChannelSummary)

  expect(firstChannelSummary[0]).toBeCloseTo(0.8, 4)
  expect(firstChannelSummary[1]).toBeCloseTo(-0.8, 4)
  expect(firstChannelSummary[2]).toBeCloseTo(0.8, 4)
  expect(firstChannelSummary[3]).toBeCloseTo(-0.8, 4)
  expect(firstChannelSummary[4]).toBeCloseTo(0.8, 4)
  expect(firstChannelSummary[5]).toBeCloseTo(-0.8, 4)
  expect(firstChannelSummary[6]).toBeCloseTo(0.8, 4)
  expect(firstChannelSummary[7]).toBeCloseTo(-0.8, 4)

  expect(secondChannelSummary[0]).toBeCloseTo(0.4, 4)
  expect(secondChannelSummary[1]).toBeCloseTo(-0.4, 4)
  expect(secondChannelSummary[2]).toBeCloseTo(0.4, 4)
  expect(secondChannelSummary[3]).toBeCloseTo(-0.4, 4)
  expect(secondChannelSummary[4]).toBeCloseTo(0.4, 4)
  expect(secondChannelSummary[5]).toBeCloseTo(-0.4, 4)
  expect(secondChannelSummary[6]).toBeCloseTo(0.4, 4)
  expect(secondChannelSummary[7]).toBeCloseTo(-0.4, 4)
})

test('speaker level estimates weight partial buckets and average channels across chunk boundaries', () => {
  const summary = new Summary(2, 8)
  const data = new Float32Array(1024 * 2)
  for (let sample = 0; sample < 1024; ++sample) {
    const bucket = Math.floor(sample / 256)
    data[sample * 2] = [0.25, 1, 0, -0.75][bucket]
    data[sample * 2 + 1] = [-0.5, 0, 0, 0.75][bucket]
  }
  summary.summarizeInterleavedData(data, data.length)

  expect(summary.getMeanSquaredPeak(128, 640)).toBeCloseTo((0.15625 * 128 + 0.5 * 256) / 512, 4)
  expect(summary.getMeanSquaredPeak(512, 768)).toBe(0)
  expect(summary.getMeanSquaredPeak(768, 1024)).toBeCloseTo(0.5625, 4)
  expect(summary.getMeanSquaredPeak(768, 1200)).toBeCloseTo(0.5625, 4)
})

test('speaker level estimates use negative peaks and return zero outside represented audio', () => {
  const summary = new Summary(1)
  expect(summary.getMeanSquaredPeak(0, 256)).toBe(0)
  const data = new Float32Array(256)
  data[3] = -0.8
  data[100] = 0.1
  summary.summarizeInterleavedData(data, data.length)

  expect(summary.getMeanSquaredPeak(-100, 256)).toBeCloseTo(0.64, 4)
  expect(summary.getMeanSquaredPeak(256, 512)).toBe(0)
  expect(summary.getMeanSquaredPeak(100, 100)).toBe(0)
})

test('speaker levels read restored summaries and their partial final bucket', async () => {
  const summary = new Summary(1)
  const values = new Int16Array([8192, -8192, 16384, -16384, 32767, -32768])
  await summary.populateFromFile(
    new File([values], 'summary'),
    new File([new Float32Array(600)], 'audio'),
    1,
  )

  expect(summary.getMeanSquaredPeak(512, 768)).toBe(1)
  expect(summary.getMeanSquaredPeak(128, 600)).toBeCloseTo((0.0625 * 128 + 0.25 * 256 + 88) / 472, 4)
})

test('a pending summary level is unknown rather than a fabricated silent level', async () => {
  const summary = new Summary(1)
  summary.length = 256
  expect(summary.getMeanSquaredPeak(0, 256)).toBeNaN()
  await summary.populateFromFile(
    new File([new Int16Array([16384, -16384])], 'summary'),
    new File([new Float32Array(256)], 'audio'),
    1,
  )
  expect(summary.getMeanSquaredPeak(0, 256)).toBeCloseTo(0.25, 4)
})
