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
  const firstChannelSummary = summary.getSummaryOfRange(0, sampleDataLength, Summary.SAMPLES_PER_SUMMARY)
  const secondChannelSummary = summary.getSummaryOfRange(0, sampleDataLength, Summary.SAMPLES_PER_SUMMARY)

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

  const firstChannelSummary = summary.getSummaryOfRange(0, sampleDataLength, Summary.SAMPLES_PER_SUMMARY)
  const secondChannelSummary = summary.getSummaryOfRange(0, sampleDataLength, Summary.SAMPLES_PER_SUMMARY)

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

  const firstChannelSummary = summary.getSummaryOfRange(0, sampleDataLength, Summary.SAMPLES_PER_SUMMARY)
  const secondChannelSummary = summary.getSummaryOfRange(0, sampleDataLength, Summary.SAMPLES_PER_SUMMARY)

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
