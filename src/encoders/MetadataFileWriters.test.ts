import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, onTestFinished, test as integrationTest } from 'vitest'
import type { MediaTags, WavSampleFormat } from './EncoderType'
import { Mp3FileWriter } from './Mp3FileWriter'
import { WavFileWriter } from './WavFileWriter'

// Exercise completed files with independent FFmpeg consumers, not serializer internals.
// Requires ffmpeg/ffprobe on PATH; the existing MP3 WASM module needs no rebuild.
const test = integrationTest.skipIf(
  ['ffmpeg', 'ffprobe'].some((command) => spawnSync(command, ['-version'], { stdio: 'ignore' }).status !== 0),
)
const tags: MediaTags = {
  TITLE: '夜の音 🎵',
  artist: 'Björk / 演奏者',
  album: 'Álbum — 東京',
  'custom field': '雪・café・🎧',
  'long note': 'é'.repeat(150), // Frame and tag sizes cross the syncsafe 7-bit boundary.
  constructor: 'An arbitrary key, not an object property',
}

class MemoryFile {
  private readonly storage = new Uint8Array(1024 * 1024)
  private position = 0
  private size = 0
  closed = false

  async write(data: ArrayBuffer | ArrayBufferView) {
    const bytes = ArrayBuffer.isView(data)
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : new Uint8Array(data)
    if (this.position + bytes.length > this.storage.length) throw new Error('Test file too large')
    this.storage.set(bytes, this.position)
    this.position += bytes.length
    this.size = Math.max(this.size, this.position)
  }

  async seek(position: number) {
    // Match the asynchronous seek contract, catching writes that fail to await it.
    await Promise.resolve()
    this.position = position
  }

  async close() {
    this.closed = true
  }

  get writable() {
    return this as unknown as FileSystemWritableFileStream
  }

  get bytes() {
    expect(this.closed).toBe(true)
    return this.storage.slice(0, this.size)
  }
}

async function consumerFile(bytes: Uint8Array, extension: string) {
  const directory = await mkdtemp(join(tmpdir(), 'soundetch-metadata-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, `audio.${extension}`)
  await writeFile(path, bytes)
  return path
}

function probe(path: string) {
  return JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', path], {
      encoding: 'utf8',
    }),
  )
}

function decode(path: string) {
  const bytes = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-map', '0:a:0', '-f', 'f32le', 'pipe:1'])
  return Float32Array.from({ length: bytes.length / 4 }, (_, i) => bytes.readFloatLE(i * 4))
}

function expectTags(actual: Record<string, string>, expected: MediaTags) {
  for (const [key, value] of Object.entries(expected)) {
    expect(actual[key.toLowerCase()] ?? actual[key]).toBe(value)
  }
}

function riffChunks(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('RIFF')
  expect(new TextDecoder().decode(bytes.subarray(8, 12))).toBe('WAVE')
  expect(view.getUint32(4, true)).toBe(bytes.length - 8)
  const chunks: { id: string; size: number; start: number }[] = []
  let offset = 12
  while (offset < bytes.length) {
    expect(offset % 2).toBe(0)
    const id = new TextDecoder().decode(bytes.subarray(offset, offset + 4))
    const size = view.getUint32(offset + 4, true)
    chunks.push({ id, size, start: offset + 8 })
    offset += 8 + size
    if (size & 1) expect(bytes[offset++]).toBe(0)
  }
  expect(offset).toBe(bytes.length)
  return chunks
}

const wavFormats: [WavSampleFormat, number][] = [
  ['int8', 1],
  ['int16', 2],
  ['int24', 3],
  ['float32', 4],
]

test.each(wavFormats)(
  'WAV %s preserves tags, data and odd/even chunk alignment',
  async (sampleFormat, bytesPerSample) => {
    for (const channelCount of [1, 2]) {
      for (const suffix of ['', 'x']) {
        const fileTags = { ...tags, alignment: suffix || 'xx' }
        const file = new MemoryFile()
        const writer = new WavFileWriter(file.writable, {
          encoder: 'wav',
          sampleRate: 48000,
          sampleCount: 5,
          channelCount,
          sampleFormat,
          tags: fileTags,
        })
        const source = [-0.75, -0.25, 0, 0.25, 0.75]
        // Split the odd data across writes: padding belongs to the chunk, not each write.
        for (const frames of [source.slice(0, 3), source.slice(3)]) {
          for (let i = 0; i < frames.length; ++i) {
            for (let channel = 0; channel < channelCount; ++channel) {
              writer.getInputBuffer()[i * channelCount + channel] = frames[i]
            }
          }
          await writer.writeChunk(frames.length)
        }
        await writer.finish()
        const bytes = file.bytes
        const chunks = riffChunks(bytes)
        expect(chunks.map((chunk) => chunk.id)).toEqual(['fmt ', 'id3 ', 'data'])
        expect(chunks[0].size).toBe(16)
        expect(chunks[2].size).toBe(source.length * channelCount * bytesPerSample)
        const path = await consumerFile(bytes, 'wav')
        const info = probe(path)
        expectTags(info.format.tags, fileTags)
        expect(info.streams[0].sample_rate).toBe('48000')
        expect(info.streams[0].channels).toBe(channelCount)
        const audio = decode(path)
        expect(audio.length).toBe(source.length * channelCount)
        for (let i = 0; i < audio.length; ++i) {
          // Integer PCM conversion truncates towards zero; unsigned 8-bit also has a DC offset.
          expect(Math.abs(audio[i] - source[Math.floor(i / channelCount)])).toBeLessThanOrEqual(1 / 64)
        }
      }
    }
  },
)

const blankTags: (MediaTags | undefined)[] = [undefined, {}, { title: '' }]

test.each(blankTags)('blank WAV metadata retains a plain PCM file (%j)', async (emptyTags) => {
  const file = new MemoryFile()
  const writer = new WavFileWriter(file.writable, {
    encoder: 'wav',
    sampleRate: 48000,
    sampleCount: 2,
    channelCount: 1,
    sampleFormat: 'int16',
    tags: emptyTags,
  })
  writer.getInputBuffer().set([-0.5, 0.5])
  await writer.writeChunk(2)
  await writer.finish()
  const bytes = file.bytes
  expect(bytes.length).toBe(48)
  expect(riffChunks(bytes).map((chunk) => chunk.id)).toEqual(['fmt ', 'data'])
  const path = await consumerFile(bytes, 'wav')
  expect(probe(path).format.tags).toBeUndefined()
  expect(Array.from(decode(path))).toEqual([-16383 / 32768, 16383 / 32768])
})

test.each([
  { channelCount: 1, sampleRate: 44100 as const, bitrate: 128000, vbrQuality: undefined },
  { channelCount: 2, sampleRate: 48000 as const, vbrQuality: 3, bitrate: undefined },
])('MP3 retains Unicode tags and the gapless LAME header (%j)', async (options) => {
  const file = new MemoryFile()
  const writer = await Mp3FileWriter.create(file.writable, { encoder: 'mp3', ...options, tags })
  const input = writer.getInputBuffer()
  const channelCapacity = Mp3FileWriter.INPUT_BUFFER_SAMPLE_SIZE
  let offset = 0
  for (const length of [12345, 48000 - 12345]) {
    for (let channel = 0; channel < options.channelCount; ++channel) {
      const frequency = channel === 0 ? 440 : 660
      for (let i = 0; i < length; ++i) {
        input[channel * channelCapacity + i] = 0.6 * Math.sin((2 * Math.PI * frequency * (offset + i)) / 48000)
      }
    }
    await writer.writeChunk(length)
    offset += length
  }
  await writer.finish()
  const bytes = file.bytes
  expect(new TextDecoder().decode(bytes.subarray(0, 3))).toBe('ID3')
  const path = await consumerFile(bytes, 'mp3')
  const info = probe(path)
  expectTags(info.format.tags, tags)
  expect(info.streams[0].sample_rate).toBe(String(options.sampleRate))
  expect(info.streams[0].channels).toBe(options.channelCount)
  // A missing/overwritten Xing/Info frame exposes encoder delay and final padding here.
  const audio = decode(path)
  expect(Math.abs(audio.length / options.channelCount - options.sampleRate)).toBeLessThanOrEqual(1)
  for (let channel = 0; channel < options.channelCount; ++channel) {
    const frequency = channel === 0 ? 440 : 660
    let squaredError = 0
    for (let frame = 100; frame < options.sampleRate - 100; ++frame) {
      const expected = 0.6 * Math.sin((2 * Math.PI * frequency * frame) / options.sampleRate)
      squaredError += (audio[frame * options.channelCount + channel] - expected) ** 2
    }
    expect(Math.sqrt(squaredError / (options.sampleRate - 200))).toBeLessThan(0.06)
  }
})

test('blank MP3 metadata leaves the audio header at the start', async () => {
  const file = new MemoryFile()
  const writer = await Mp3FileWriter.create(file.writable, {
    encoder: 'mp3',
    sampleRate: 48000,
    channelCount: 1,
    vbrQuality: 3,
    bitrate: undefined,
    tags: { title: '' },
  })
  writer.getInputBuffer().fill(0, 0, 4800)
  await writer.writeChunk(4800)
  await writer.finish()
  const bytes = file.bytes
  expect(bytes[0]).toBe(0xff)
  expect(bytes[1] & 0xe0).toBe(0xe0)
  const path = await consumerFile(bytes, 'mp3')
  expect(probe(path).format.tags ?? {}).not.toHaveProperty('title')
  expect(decode(path).length).toBe(4800)
})
