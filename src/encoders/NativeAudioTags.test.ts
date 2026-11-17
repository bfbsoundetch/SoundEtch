import { spawnSync } from 'node:child_process'
import { afterEach, beforeEach, expect, test as integrationTest } from 'vitest'
import { GlobalSettings } from '../global/GlobalSettings'
import { FlacFileWriter } from './FlacFileWriter'
import { OpusFileWriter } from './OpusFileWriter'
import { OpusApplication, OpusBandwidth, OpusBitrateMode } from './EncoderType'
import type { MediaTags } from './EncoderType'

// Optional independent consumers; don't require system media tools for the unit suite.
const test = integrationTest.skipIf(
  ['ffmpeg', 'ffprobe'].some((command) => spawnSync(command, ['-version'], { stdio: 'ignore' }).status !== 0),
)

const sampleRate = 48000
const frameCount = 4800
let previousMemoryFS: boolean

beforeEach(() => {
  previousMemoryFS = GlobalSettings.useMemoryFS
  GlobalSettings.useMemoryFS = true
})

afterEach(() => {
  GlobalSettings.useMemoryFS = previousMemoryFS
})

const tagCases: Array<[string, MediaTags | undefined]> = [
  ['no metadata', undefined],
  ['empty metadata', {}],
  ['empty values', { title: '', 'CUSTOM-KEY': '' }],
  [
    'Unicode and arbitrary keys',
    {
      title: '夜の音楽 🎵',
      artist: 'Björk / الفنان',
      album: 'Café — Ελληνικά',
      'CUSTOM-KEY': 'first=second\n第三行',
      'custom key!}': 'Привет 🌍',
    },
  ],
  ['multi-page comments', { 'LONG-COMMENT': '雪🎵='.repeat(12000) }],
  ['custom encoder', { encoder: '自作 encoder 🎛️' }],
]

for (const format of ['flac', 'opus'] as const) {
  test.each(tagCases)(
    `${format} round-trips %s and decodable audio`,
    async (_name, tags) => {
      const bytes = await encode(format, tags)
      const probe = JSON.parse(
        run(
          'ffprobe',
          [
            '-v',
            'error',
            '-show_entries',
            'format_tags:stream=codec_name,sample_rate,channels,bits_per_raw_sample:stream_tags',
            '-of',
            'json',
            '-i',
            'pipe:0',
          ],
          bytes,
        ).toString('utf8'),
      )
      const stream = probe.streams[0]
      expect(stream.codec_name).toBe(format)
      expect(Number(stream.sample_rate)).toBe(sampleRate)
      expect(stream.channels).toBe(2)
      if (format === 'flac') expect(Number(stream.bits_per_raw_sample)).toBe(24)

      const actualTags = Object.fromEntries(
        Object.entries({ ...probe.format?.tags, ...stream.tags }).map(([key, value]) => [key.toLowerCase(), value]),
      )
      for (const [key, value] of Object.entries(tags ?? {})) {
        if (value !== '') expect(actualTags[key.toLowerCase()]).toBe(value)
        else expect(actualTags).not.toHaveProperty(key.toLowerCase())
      }
      if (!tags || Object.values(tags).every((value) => value === '')) {
        expect(Object.keys(actualTags).filter((key) => key !== 'encoder')).toEqual([])
      }
      if (format === 'opus' && !tags?.encoder) expect(actualTags.encoder).toBe('soundetch')
      if (tags?.encoder) expect(actualTags.encoder).toBe(tags.encoder)

      const decoded = run(
        'ffmpeg',
        ['-v', 'error', '-i', 'pipe:0', '-f', 'f32le', '-acodec', 'pcm_f32le', 'pipe:1'],
        bytes,
      )
      expect(decoded.byteLength).toBe(frameCount * 2 * Float32Array.BYTES_PER_ELEMENT)
      let squaredError = 0
      let energy = 0
      for (let frame = 0; frame < frameCount; frame++) {
        for (let channel = 0; channel < 2; channel++) {
          const sample = decoded.readFloatLE((frame * 2 + channel) * Float32Array.BYTES_PER_ELEMENT)
          const expected = signal(frame, channel)
          squaredError += (sample - expected) ** 2
          energy += sample ** 2
        }
      }
      expect(energy / (frameCount * 2)).toBeGreaterThan(0.01)
      expect(Math.sqrt(squaredError / (frameCount * 2))).toBeLessThan(format === 'flac' ? 0.000001 : 0.08)
    },
    30000,
  )
}

test('FLAC rejects tag names outside the Vorbis character range', async () => {
  await expect(encode('flac', { 'invalid~key': 'value' })).rejects.toThrow('Unable to initialize FLAC encoder')
})

function signal(frame: number, channel: number) {
  return Math.sin((2 * Math.PI * (channel === 0 ? 440 : 660) * frame) / sampleRate) * 0.5
}

async function encode(format: 'flac' | 'opus', tags: MediaTags | undefined) {
  const chunks: Uint8Array[] = []
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      chunks.push(chunk.slice())
    },
  }) as FileSystemWritableFileStream
  const writer =
    format === 'flac'
      ? await FlacFileWriter.create(writable, {
          encoder: 'flac',
          sampleRate,
          channelCount: 2,
          bitDepth: 24,
          compressionLevel: 8,
          tags,
        })
      : await OpusFileWriter.create(writable, {
          encoder: 'opus',
          sampleRate,
          channelCount: 2,
          bitrate: 128000,
          bitrateMode: OpusBitrateMode.CONSTRAINED,
          complexity: 5,
          bandwidth: OpusBandwidth.FULLBAND,
          application: OpusApplication.OPUS_APPLICATION_AUDIO,
          frameSize: 20,
          tags,
        })
  const input = writer.getInputBuffer()
  for (let frame = 0; frame < frameCount; frame++) {
    for (let channel = 0; channel < 2; channel++) {
      input[format === 'flac' ? channel * (input.length / 2) + frame : frame * 2 + channel] = signal(frame, channel)
    }
  }
  await writer.writeChunk(frameCount)
  if (writer instanceof FlacFileWriter) writer.checkStatus()
  await writer.finish()
  return Buffer.concat(chunks)
}

function run(command: string, args: string[], input: Uint8Array) {
  const result = spawnSync(command, args, { input, maxBuffer: 8 * 1024 * 1024 })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command}: ${result.stderr.toString('utf8')}`)
  return result.stdout
}
