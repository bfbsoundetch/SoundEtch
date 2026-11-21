import { createHash } from 'node:crypto'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { UploadLink } from '../backup/CloudStorage'
import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import { GlobalSettings } from '../global/GlobalSettings'
import type { VideoTrackRecorderOptions } from '../recording/VideoTrackRecorder'
import {
  type CloudManifest,
  CloudMediaTransport,
  type CloudMediaTransportOptions,
  HQ_UPLOAD_MIN_INTERVAL_MS,
} from './CloudMediaTransport'
import { UploadLinkUnusableError } from './CloudUploadLink'
import { HQ_AUDIO_CHUNK_FRAMES, HQ_FRAME_BYTES, HQ_UPLOAD_SPOOL_DIRECTORY } from './HighQualityAudioFormat'
import type { HighQualityMessage } from './RemoteMediaClient3'

vi.mock('../ui/NotificationsController', () => ({
  NotificationsController: { showLongDurationMessage: () => ({ updateMessage() {}, remove() {} }) },
}))

GlobalSettings.useMemoryFS = true

const SESSION = 'session-1'
const DROPBOX = 'https://content.dropboxapi.com/upload/'
const S3 = 'https://bucket.s3.example.com/'

/** Dropbox's content hash for data under 4 MiB, computed independently of the code under test. */
function referenceHash(data: Uint8Array) {
  return createHash('sha256').update(createHash('sha256').update(data).digest()).digest('hex')
}

type Upload = { name: string; method: string; at: number; bytes: Uint8Array }

/** Answers like Dropbox for POST links (returns the content hash) and like S3 for PUT links (returns nothing). */
class FakeUploader {
  readonly uploads = new Array<Upload>()
  /** Statuses to refuse the next uploads of a name with. */
  readonly refusals = new Map<string, number[]>()
  /** Names whose Dropbox answer reports a different hash. */
  readonly corrupt = new Set<string>()

  readonly upload = async (link: UploadLink, bytes: Uint8Array<ArrayBuffer>) => {
    const name = link.url.slice(link.url.lastIndexOf('/') + 1)
    const status = this.refusals.get(name)?.shift()
    if (status) throw new UploadLinkUnusableError(status)
    this.uploads.push({ name, method: link.method, at: Date.now(), bytes: bytes.slice() })
    if (link.method == 'PUT') return null
    return this.corrupt.has(name) ? 'f'.repeat(64) : referenceHash(bytes)
  }
}

let sent: HighQualityMessage[]
let uploader: FakeUploader
let transport: CloudMediaTransport

function createTransport(
  video = false,
  createVideoRecorder: CloudMediaTransportOptions['createVideoRecorder'] = () => ({
    attach() {},
    finish: async () => null,
  }),
) {
  transport = new CloudMediaTransport({
    channel: { sendHighQuality: (_peerId, message) => (sent.push(message), true) },
    recorderPeerId: 'recorder',
    recorderName: 'Recorder',
    sessionId: SESSION,
    video,
    capture: { elapsedSamples: () => 0 },
    createVideoRecorder,
    upload: uploader.upload,
    onStopped: () => {},
  })
}

function links(names: string[], base = DROPBOX, method: 'POST' | 'PUT' = 'POST') {
  transport.addLinks(names.map((name) => ({ name, method, url: base + name })))
}

function emit(from: number, count: number) {
  for (let seq = from; seq < from + count; seq++)
    transport.addFrame(seq, new Int16Array(HQ_FRAME_BYTES / 2).fill(seq).buffer)
}

function ofType<T extends HighQualityMessage['type']>(type: T) {
  return sent.filter((message) => message.type == type) as Array<Extract<HighQualityMessage, { type: T }>>
}

/** Lets promise chains and the hash computations behind them settle; setImmediate stays real. */
async function settle(rounds = 200) {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setImmediate(resolve))
}

/** Settles until `condition` holds, for steps that hash megabytes on the thread pool. */
async function until(condition: () => boolean) {
  for (let i = 0; i < 10000 && !condition(); i++) await new Promise((resolve) => setImmediate(resolve))
  expect(condition()).toBe(true)
}

async function spoolFiles() {
  return (await FileSystemUtils.getDirectoryFiles(HQ_UPLOAD_SPOOL_DIRECTORY)).map((file) => file.path)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  Object.assign(globalThis, { window: globalThis, addEventListener: () => {}, removeEventListener: () => {} })
  sent = []
  uploader = new FakeUploader()
})

afterEach(async () => {
  transport.cancel()
  await transport.settled
  vi.useRealTimers()
})

test('300 frames make one audio chunk with its header', async () => {
  createTransport()
  links(['audio-00001.pcm'])
  emit(0, HQ_AUDIO_CHUNK_FRAMES)
  await until(() => ofType('hqUploaded').length == 1)
  await settle()
  expect(uploader.uploads.map((upload) => upload.name)).toEqual(['audio-00001.pcm'])
  const bytes = uploader.uploads[0].bytes
  expect(bytes.byteLength).toBe(16 + HQ_AUDIO_CHUNK_FRAMES * HQ_FRAME_BYTES)
  const view = new DataView(bytes.buffer, bytes.byteOffset)
  expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('SEHQ')
  expect([view.getUint16(4, true), view.getUint16(6, true), view.getUint32(8, true), view.getUint32(12, true)]).toEqual(
    [1, 0, 0, 300],
  )
  expect(view.getInt16(16 + 299 * HQ_FRAME_BYTES, true)).toBe(299)
  expect(ofType('hqUploaded')).toEqual([
    {
      type: 'hqUploaded',
      sessionId: SESSION,
      name: 'audio-00001.pcm',
      size: bytes.byteLength,
      contentHash: referenceHash(bytes),
    },
  ])
  expect(await spoolFiles()).toEqual([])
})

test('a seq gap seals the chunk early', async () => {
  createTransport()
  links(['audio-00001.pcm', 'audio-00002.pcm'], S3, 'PUT')
  emit(0, 10)
  emit(15, HQ_AUDIO_CHUNK_FRAMES)
  await until(() => ofType('hqUploaded').length == 1)
  await vi.advanceTimersByTimeAsync(HQ_UPLOAD_MIN_INTERVAL_MS)
  await until(() => ofType('hqUploaded').length == 2)
  const headers = uploader.uploads.map((upload) => {
    const view = new DataView(upload.bytes.buffer, upload.bytes.byteOffset)
    return [upload.name, view.getUint32(8, true), view.getUint32(12, true)]
  })
  expect(headers).toEqual([
    ['audio-00001.pcm', 0, 10],
    ['audio-00002.pcm', 15, 300],
  ])
})

test('a link to another origin than the first one is never used', async () => {
  createTransport()
  links(['audio-00001.pcm'])
  links(['audio-00002.pcm'], 'https://elsewhere.example/')
  emit(0, 2 * HQ_AUDIO_CHUNK_FRAMES)
  await until(() => ofType('hqUploaded').length == 1)
  await vi.advanceTimersByTimeAsync(HQ_UPLOAD_MIN_INTERVAL_MS + 1000)
  await settle()
  expect(uploader.uploads.map((upload) => upload.name)).toEqual(['audio-00001.pcm'])
  expect(ofType('hqLinkRequest')).toEqual([{ type: 'hqLinkRequest', sessionId: SESSION, names: ['audio-00002.pcm'] }])
})

for (const [service, base, method, status] of [
  ['Dropbox', DROPBOX, 'POST', 410],
  ['S3', S3, 'PUT', 403],
] as const) {
  test(`a ${service} ${status} asks for a new link, and the retry succeeds`, async () => {
    createTransport()
    uploader.refusals.set('audio-00001.pcm', [status])
    links(['audio-00001.pcm'], base, method)
    emit(0, HQ_AUDIO_CHUNK_FRAMES)
    await until(() => uploader.refusals.get('audio-00001.pcm')!.length == 0)
    await settle()
    await vi.advanceTimersByTimeAsync(1000)
    expect(ofType('hqLinkRequest')).toEqual([{ type: 'hqLinkRequest', sessionId: SESSION, names: ['audio-00001.pcm'] }])
    links(['audio-00001.pcm'], base, method)
    await vi.advanceTimersByTimeAsync(HQ_UPLOAD_MIN_INTERVAL_MS)
    await until(() => ofType('hqUploaded').length == 1)
    expect(uploader.uploads.map((upload) => upload.name)).toEqual(['audio-00001.pcm'])
    expect(ofType('hqUploaded').map((message) => message.name)).toEqual(['audio-00001.pcm'])
  })
}

test('three refused uploads in a row fail the session', async () => {
  createTransport()
  uploader.refusals.set('audio-00001.pcm', [410, 410, 410])
  emit(0, HQ_AUDIO_CHUNK_FRAMES)
  for (let attempt = 0; attempt < 3; attempt++) {
    links(['audio-00001.pcm'])
    await until(() => uploader.refusals.get('audio-00001.pcm')!.length == 2 - attempt)
    await vi.advanceTimersByTimeAsync(HQ_UPLOAD_MIN_INTERVAL_MS)
  }
  expect(ofType('hqFailed')).toEqual([
    {
      type: 'hqFailed',
      sessionId: SESSION,
      message: 'The cloud storage rejected the upload; it may be full or the link expired.',
    },
  ])
  await transport.settled
  expect(await spoolFiles()).toEqual([])
})

test('a Dropbox upload whose content hash differs is not reported as uploaded', async () => {
  createTransport()
  uploader.corrupt.add('audio-00001.pcm')
  links(['audio-00001.pcm'])
  emit(0, HQ_AUDIO_CHUNK_FRAMES)
  await until(() => uploader.uploads.length == 1)
  await settle()
  expect(uploader.uploads).toHaveLength(1)
  expect(ofType('hqUploaded')).toEqual([])
  expect(await spoolFiles()).toEqual([`${SESSION}-audio-00001.pcm`])
})

test('live uploads start at least 5 s apart; after end() they run back to back', async () => {
  createTransport()
  links(['audio-00001.pcm', 'audio-00002.pcm', 'audio-00003.pcm', 'manifest.json'])
  emit(0, 3 * HQ_AUDIO_CHUNK_FRAMES)
  await until(() => ofType('hqUploaded').length == 1)
  await settle()
  expect(uploader.uploads).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(HQ_UPLOAD_MIN_INTERVAL_MS - 1)
  await settle()
  expect(uploader.uploads).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(1)
  await until(() => ofType('hqUploaded').length == 2)
  expect(uploader.uploads[1].at - uploader.uploads[0].at).toBeGreaterThanOrEqual(HQ_UPLOAD_MIN_INTERVAL_MS)

  const endedAt = Date.now()
  await transport.end()
  await transport.settled
  expect(uploader.uploads.map((upload) => [upload.name, upload.at])).toEqual([
    ['audio-00001.pcm', endedAt - HQ_UPLOAD_MIN_INTERVAL_MS],
    ['audio-00002.pcm', endedAt],
    ['audio-00003.pcm', endedAt],
    ['manifest.json', endedAt],
  ])
})

test('end() requests missing links and uploads the manifest last; the spool is then empty', async () => {
  const videoBytes = new Uint8Array(100)
  videoBytes.set(new TextEncoder().encode('ftypisomstsdavc1'), 10)
  createTransport(true, (options: VideoTrackRecorderOptions) => ({
    attach() {},
    finish: async () => {
      if (options.output.kind != 'sink') throw new Error('expected a sink')
      const sink = await options.output.open()
      await sink.write(videoBytes, 0)
      await sink.close()
      return null
    },
  }))
  links(['audio-00001.pcm'])
  emit(0, HQ_AUDIO_CHUNK_FRAMES + 150)
  await until(() => ofType('hqUploaded').length == 1)
  expect(uploader.uploads.map((upload) => upload.name)).toEqual(['audio-00001.pcm'])

  const ending = transport.end()
  await ending
  const requested = ofType('hqLinkRequest').flatMap((message) => message.names)
  expect(requested.sort()).toEqual(['audio-00002.pcm', 'manifest.json', 'video-00001.part'])
  links(requested)
  await transport.settled

  expect(uploader.uploads.map((upload) => upload.name)).toEqual([
    'audio-00001.pcm',
    'video-00001.part',
    'audio-00002.pcm',
    'manifest.json',
  ])
  const uploaded = ofType('hqUploaded')
  const manifestUpload = uploader.uploads.at(-1)!
  const manifest = JSON.parse(new TextDecoder().decode(manifestUpload.bytes)) as CloudManifest
  const reported = (name: string) => uploaded.find((message) => message.name == name)!
  expect(manifest).toEqual({
    format: 'soundetch-meeting-media',
    version: 1,
    sessionId: SESSION,
    frameCount: 450,
    audio: [
      { name: 'audio-00001.pcm', firstSeq: 0, frameCount: 300, ...sizeAndHash(reported('audio-00001.pcm')) },
      { name: 'audio-00002.pcm', firstSeq: 300, frameCount: 150, ...sizeAndHash(reported('audio-00002.pcm')) },
    ],
    video: {
      codec: 'avc',
      size: 100,
      chunks: [{ name: 'video-00001.part', size: 100, contentHash: referenceHash(videoBytes) }],
    },
    complete: true,
  })
  for (const upload of uploader.uploads) expect(reported(upload.name).contentHash).toBe(referenceHash(upload.bytes))
  expect(sent.at(-1)).toEqual({ type: 'hqComplete', sessionId: SESSION })
  expect(await spoolFiles()).toEqual([])
})

function sizeAndHash(message: { size: number; contentHash: string }) {
  return { size: message.size, contentHash: message.contentHash }
}
