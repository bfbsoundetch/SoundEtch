import { Summary } from './Summary'
import type { FileSystemSyncAccessHandle } from '../filesystem/FileSystemSyncAccessHandle'
import { MemoryBackedFileSystemSyncAccessHandle } from '../filesystem/MemoryBackedFileSystemSyncAccessHandle'

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
  const bothChannelSummary = summary.getSummaryOfBins([0, 256, 512, 768, sampleDataLength])
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

  const bothChannelSummary = summary.getSummaryOfBins([0, 256, 512, 768, sampleDataLength])
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

  const bothChannelSummary = summary.getSummaryOfBins([0, 256, 512, 768, sampleDataLength])
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
  await summary.populateFromFile(new File([values], 'summary'), new File([new Float32Array(600)], 'audio'), 1)

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

test('finishing an empty recording closes the summary without writing a nonexistent bucket', () => {
  const summary = new Summary(1)
  const handle = summaryHandle()
  summary.setSyncFileHandle(handle)

  summary.finishSummarizing()

  expect(handle.write).not.toHaveBeenCalled()
  expect(handle.close).toHaveBeenCalledOnce()
})

test('finishing an exact bucket does not append an unwritten extra bucket', async () => {
  const summary = new Summary(1)
  const handle = new MemoryBackedFileSystemSyncAccessHandle('summary')
  summary.setSyncFileHandle(handle)
  summary.summarizeInterleavedData(new Float32Array(256).fill(0.5), 256)

  summary.finishSummarizing()

  expect((await handle.getFile()).size).toBe(4)
})

test('final summary quota failure closes the handle and is not masked by a close failure', () => {
  const summary = new Summary(1)
  const handle = summaryHandle()
  const quota = new DOMException('Summary storage is full', 'QuotaExceededError')
  summary.setSyncFileHandle(handle)
  summary.summarizeInterleavedData(new Float32Array([0.5]), 1)
  handle.write.mockImplementation(() => {
    throw quota
  })
  handle.close.mockImplementation(() => {
    throw new Error('Close failed')
  })

  expect(() => summary.finishSummarizing()).toThrow(quota)
  expect(handle.close).toHaveBeenCalledOnce()
  expect(() => summary.finishSummarizing()).not.toThrow()
  expect(handle.close).toHaveBeenCalledOnce()
})

test('a summary write failure still represents all saved input frames in memory', () => {
  const summary = new Summary(1)
  const handle = summaryHandle()
  const quota = new DOMException('Summary storage is full', 'QuotaExceededError')
  summary.setSyncFileHandle(handle)
  handle.write.mockImplementation(() => {
    throw quota
  })
  const data = new Float32Array(600).fill(-0.5)

  expect(() => summary.summarizeInterleavedData(data, data.length)).toThrow(quota)

  expect(summary.length).toBe(600)
  expect(summary.getSummaryOfBins([512, 600])[0]).toEqual([expect.closeTo(-0.5, 4), expect.closeTo(-0.5, 4)])
  expect(handle.write).toHaveBeenCalledOnce()
  expect(() => summary.finishSummarizing()).not.toThrow()
  expect(handle.write).toHaveBeenCalledOnce()
  expect(handle.close).toHaveBeenCalledOnce()
})

test('summary short writes preserve both complete and partial waveform buckets', async () => {
  const summary = new Summary(1)
  const handle = new MemoryBackedFileSystemSyncAccessHandle('summary')
  const access: FileSystemSyncAccessHandle = handle
  const write = access.write.bind(access)
  vi.spyOn(access, 'write').mockImplementation((buffer, options) => {
    const bytes = ArrayBuffer.isView(buffer)
      ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
      : new Uint8Array(buffer)
    return write(bytes.subarray(0, 1), options)
  })
  summary.setSyncFileHandle(handle)
  summary.summarizeInterleavedData(new Float32Array(257).fill(0.5), 257)

  summary.finishSummarizing()

  expect(new Int16Array(await (await handle.getFile()).arrayBuffer())).toEqual(
    new Int16Array([16384, 16384, 16384, 16384]),
  )
})

test('an empty summary is regenerated from saved stereo PCM without advertising an incomplete frame', async () => {
  const data = new Float32Array([0.25, -0.5, 0.75, -1, 0.125])
  const summary = new Summary(2)

  await summary.populateFromFile(new File([], 'summary'), new File([data], 'audio'), 2)

  expect(summary.length).toBe(2)
  expect(summary.getSummaryOfBins([0, 2])).toEqual([
    [expect.closeTo(0.75, 4), expect.closeTo(0.25, 4)],
    [expect.closeTo(-0.5, 4), expect.closeTo(-1, 4)],
  ])
})

test('a partial summary bucket is rebuilt only from the missing saved audio tail', async () => {
  const data = new Float32Array(600).fill(-0.75)
  data.fill(0.25, 0, 256)
  const persisted = new Int16Array([8192, 8192])
  const mainFile = new File([data], 'audio')
  const readTail = vi.spyOn(mainFile, 'slice')
  const summary = new Summary(1)

  await summary.populateFromFile(new File([persisted, new Uint8Array([255, 255, 255])], 'summary'), mainFile, 1)

  expect(summary.length).toBe(600)
  expect(readTail).toHaveBeenCalledExactlyOnceWith(256 * 4, 600 * 4)
  expect(summary.getSummaryOfBins([0, 256, 512, 600])[0]).toEqual([
    expect.closeTo(0.25, 4),
    expect.closeTo(0.25, 4),
    expect.closeTo(-0.75, 4),
    expect.closeTo(-0.75, 4),
    expect.closeTo(-0.75, 4),
    expect.closeTo(-0.75, 4),
  ])
})

test('missing summary recovery reads saved audio in bounded chunks', async () => {
  const frameCount = 8192 + 257
  const data = new Float32Array(frameCount).fill(0.5)
  const mainFile = new File([data], 'audio')
  const reads = vi.spyOn(mainFile, 'slice')
  const summary = new Summary(1)

  await summary.populateFromFile(new File([], 'summary'), mainFile, 1)

  expect(reads.mock.calls).toEqual([
    [0, 8192 * 4],
    [8192 * 4, frameCount * 4],
  ])
  expect(summary.length).toBe(frameCount)
  expect(summary.getMeanSquaredPeak(8192, frameCount)).toBeCloseTo(0.25, 4)
})

test('bins straddling buckets each take the buckets centered in them, so a peak shows in one bin', () => {
  const summary = new Summary(1, 4)
  const data = new Float32Array(1024)
  data[300] = 0.5
  summary.summarizeInterleavedData(data, data.length)

  // Bucket middles are 128, 384, 640 and 896; the last bin holds none, so it takes the bucket it starts in.
  const maxima = summary.getSummaryOfBins([0, 300, 600, 900, 1024])[0].filter((_, index) => index % 2 === 0)

  expect(maxima).toEqual([0, expect.closeTo(0.5, 4), 0, 0])
})

function summaryHandle() {
  return {
    write: vi.fn((buffer: BufferSource, _options?: { at: number }) => buffer.byteLength),
    flush: vi.fn(),
    close: vi.fn(),
    getSize: vi.fn(() => 0),
    read: vi.fn(() => 0),
    truncate: vi.fn(),
  } satisfies FileSystemSyncAccessHandle
}
