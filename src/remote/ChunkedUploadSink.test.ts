import { expect, test } from 'vitest'
import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import { GlobalSettings } from '../global/GlobalSettings'
import { ChunkedUploadSink, type SealedVideoChunk } from './ChunkedUploadSink'
import { HQ_VIDEO_CHUNK_BYTES } from './HighQualityAudioFormat'

GlobalSettings.useMemoryFS = true

const MIB = 1024 * 1024

function pattern(start: number, length: number) {
  const bytes = new Uint8Array(length)
  for (let i = 0; i < length; i++) bytes[i] = (start + i) % 251
  return bytes
}

async function readChunk(directory: string, chunk: SealedVideoChunk) {
  const file = await FileSystemUtils.getExistingFile(directory, chunk.file)
  // The memory file system grows a file's size by every write, overwrites included, so read only the real extent.
  return new Uint8Array(await file.slice(0, chunk.size).arrayBuffer())
}

test('a sequential stream seals 8/8/4 MiB chunks in order with the written bytes', async () => {
  expect(HQ_VIDEO_CHUNK_BYTES).toBe(8 * MIB)
  const sealed: SealedVideoChunk[] = []
  const sink = new ChunkedUploadSink('seq', (chunk) => sealed.push(chunk))
  const total = 20 * MIB
  // An odd write size makes writes straddle chunk boundaries.
  const step = 3 * MIB + 7
  for (let at = 0; at < total; at += step) await sink.write(pattern(at, Math.min(step, total - at)), at)
  expect(sealed.map((chunk) => chunk.index)).toEqual([1, 2])
  await sink.close()
  expect(sealed).toEqual([
    { name: 'video-00001.part', file: 'video-00001.part', index: 1, size: 8 * MIB },
    { name: 'video-00002.part', file: 'video-00002.part', index: 2, size: 8 * MIB },
    { name: 'video-00003.part', file: 'video-00003.part', index: 3, size: 4 * MIB },
  ])
  for (const [i, chunk] of sealed.entries()) {
    // Deep equality over megabytes is too slow; compare buffers directly.
    expect(Buffer.from(await readChunk('seq', chunk)).equals(pattern(i * 8 * MIB, chunk.size))).toBe(true)
  }
})

test('an overwrite inside the open chunk is applied', async () => {
  const sealed: SealedVideoChunk[] = []
  const sink = new ChunkedUploadSink('overwrite', (chunk) => sealed.push(chunk), 'session-')
  await sink.write(pattern(0, 1000), 0)
  await sink.write(new Uint8Array([9, 9, 9, 9]), 100)
  await sink.close()
  const expected = pattern(0, 1000)
  expected.set([9, 9, 9, 9], 100)
  // The spool file carries the prefix; the cloud name does not.
  expect(sealed).toEqual([{ name: 'video-00001.part', file: 'session-video-00001.part', index: 1, size: 1000 }])
  expect(await readChunk('overwrite', sealed[0])).toEqual(expected)
})

test('a write into a sealed chunk throws', async () => {
  const sink = new ChunkedUploadSink('sealed', () => {})
  await sink.write(pattern(0, 16), 0)
  await sink.write(pattern(0, 16), HQ_VIDEO_CHUNK_BYTES)
  await expect(sink.write(new Uint8Array(4), 8)).rejects.toThrow()
})
