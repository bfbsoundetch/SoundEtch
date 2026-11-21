import { RingBuffer } from 'ringbuf.js'
import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import type { FileSystemSyncAccessHandle } from '../filesystem/FileSystemSyncAccessHandle'
import { MemoryBackedFileSystem } from '../filesystem/MemoryBackedFileSystem'
import { MemoryBackedFileSystemSyncAccessHandle } from '../filesystem/MemoryBackedFileSystemSyncAccessHandle'
import { GlobalSettings } from '../global/GlobalSettings'
import { Summary } from '../project/Summary'
import type { Run } from '../remote/HighQualityAlignment'
import { HQ_FRAME_BYTES, HQ_FRAME_SAMPLES, HQ_SAMPLE_RATE } from '../remote/HighQualityAudioFormat'
import { AudioFileWriter } from './AudioFileWriter'
import { attachPatchPort } from './HighQualityPatchService'
import type { PatchReply, PatchRequest } from './HighQualityPatchService'

GlobalSettings.useMemoryFS = true

const DIRNAME = 'hq-patch-test'
const DELAY = 7321
const SECONDS = 30
const CROSSFADE_SAMPLES = 240
const FRAMES_PER_MESSAGE = 50

function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

/** Syllables of voiced harmonics plus breathy noise, separated by short pauses, as int16. */
function makeSpeech(seconds: number, seed: number): Int16Array {
  const random = seededRandom(seed)
  const output = new Int16Array(seconds * HQ_SAMPLE_RATE)
  let position = 0
  let breath = 0
  while (position < output.length) {
    position += Math.floor((0.05 + random() * 0.25) * HQ_SAMPLE_RATE)
    const length = Math.floor((0.1 + random() * 0.25) * HQ_SAMPLE_RATE)
    const pitch = 100 + random() * 150
    const loudness = 0.1 + random() * 0.2
    for (let index = 0; index < length && position + index < output.length; ++index) {
      const envelope = Math.sin((Math.PI * index) / length)
      let voiced = 0
      for (let harmonic = 1; harmonic <= 4; ++harmonic) {
        voiced += Math.sin((2 * Math.PI * pitch * harmonic * index) / HQ_SAMPLE_RATE) / harmonic
      }
      breath += 0.3 * (random() * 2 - 1 - breath)
      const value = loudness * envelope * (0.5 * voiced + 1.5 * breath)
      output[position + index] = Math.round(Math.max(-1, Math.min(1, value)) * 32767)
    }
    position += length
  }
  return output
}

/** The recorder's "Opus" of `hq`: delayed by `DELAY`, lowpassed, with −40 dB noise. */
function makeOpus(hq: Int16Array, seed: number): Float32Array {
  const random = seededRandom(seed)
  const output = new Float32Array(hq.length + DELAY + HQ_SAMPLE_RATE)
  let state = 0
  for (let index = 0; index < output.length; ++index) {
    const source = index - DELAY
    if (source >= 0 && source < hq.length) state += 0.6 * (hq[source] / 32768 - state)
    output[index] = (random() * 2 - 1) * 0.01 * Math.sqrt(3) + (source >= 0 && source < hq.length ? state : 0)
  }
  return output
}

const speech = makeSpeech(SECONDS, 1)
const opus = makeOpus(speech, 2)
const frameCount = speech.length / HQ_FRAME_SAMPLES

type SyncFile = FileSystemFileHandle & { createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle> }

/** Records `samples` as a clip through a real writer; with `liveKey`, the writer stays open, as during a recording. */
async function recordClip(filename: string, samples: Float32Array, liveKey: string | null = null) {
  MemoryBackedFileSystem.deleteFile(DIRNAME, filename)
  MemoryBackedFileSystem.deleteFile(DIRNAME, `${filename}_summary`)
  const audio = await ((await FileSystemUtils.getFileHandle(DIRNAME, filename)) as SyncFile).createSyncAccessHandle()
  const summaryHandle = await (
    (await FileSystemUtils.getFileHandle(DIRNAME, `${filename}_summary`)) as SyncFile
  ).createSyncAccessHandle()
  const summary = new Summary(1)
  summary.setSyncFileHandle(summaryHandle)
  const ringBufferArray = RingBuffer.getStorageForCapacity(16384, Float32Array)
  const ringBuffer = new RingBuffer(ringBufferArray, Float32Array)
  const writer = new AudioFileWriter(
    audio,
    summary,
    ringBufferArray,
    new SharedArrayBuffer(4),
    1,
    liveKey ? { key: liveKey, summaryHandle } : null,
  )
  for (let position = 0; position < samples.length; position += 8192) {
    ringBuffer.push(samples.subarray(position, Math.min(samples.length, position + 8192)))
    await writer.maybeGetChunkAndWrite()
  }
  const finish = async () => {
    writer.stop()
    await writer.runFileWritingLoop()
  }
  if (!liveKey) await finish()
  return { summary, finish }
}

async function fileBytes(filename: string): Promise<Uint8Array> {
  return new Uint8Array(await (await FileSystemUtils.getExistingFile(DIRNAME, filename)).arrayBuffer())
}

async function fileSamples(filename: string): Promise<Float32Array> {
  return new Float32Array(await (await FileSystemUtils.getExistingFile(DIRNAME, filename)).arrayBuffer())
}

const openPorts = new Array<MessagePort>()

function connect() {
  const { port1, port2 } = new MessageChannel()
  attachPatchPort(port2)
  openPorts.push(port1, port2)
  const replies = new Array<PatchReply>()
  const waiters = new Array<{ predicate: (reply: PatchReply) => boolean; resolve: (reply: PatchReply) => void }>()
  port1.addEventListener('message', (event: MessageEvent<PatchReply>) => {
    replies.push(event.data)
    for (const waiter of [...waiters]) {
      if (waiter.predicate(event.data)) {
        waiters.splice(waiters.indexOf(waiter), 1)
        waiter.resolve(event.data)
      }
    }
  })
  port1.start()
  return {
    replies,
    send(message: PatchRequest, transfer: Transferable[] = []) {
      port1.postMessage(message, transfer)
    },
    next<T extends PatchReply['type']>(type: T): Promise<Extract<PatchReply, { type: T }>> {
      const { promise, resolve } = Promise.withResolvers<PatchReply>()
      waiters.push({ predicate: (reply) => reply.type === type, resolve })
      return promise as Promise<Extract<PatchReply, { type: T }>>
    },
  }
}

type Connection = ReturnType<typeof connect>

/** Opens `key` on `filename` and sends every high-quality frame, then the frame count. */
function sendSession(connection: Connection, key: string, filename: string, segmentEnd: number) {
  connection.send({ type: 'open', key, dirname: DIRNAME, filename, priorFrame: 0, segmentStart: 0, segmentEnd })
  for (let firstSeq = 0; firstSeq < frameCount; firstSeq += FRAMES_PER_MESSAGE) {
    const pcm = speech.slice(firstSeq * HQ_FRAME_SAMPLES, (firstSeq + FRAMES_PER_MESSAGE) * HQ_FRAME_SAMPLES).buffer
    expect(pcm.byteLength).toBe(FRAMES_PER_MESSAGE * HQ_FRAME_BYTES)
    connection.send({ type: 'frames', key, firstSeq, pcm }, [pcm])
  }
  connection.send({ type: 'finish', key, frameCount })
}

async function patch(filename: string, key: string) {
  const connection = connect()
  const outcome = Promise.race([connection.next('done'), connection.next('failed')])
  sendSession(connection, key, filename, opus.length)
  return { connection, outcome: await outcome }
}

function expectRunInteriorsEqualSpeech(samples: Float32Array, runs: readonly Run[]) {
  for (const run of runs) {
    const interior = samples.subarray(
      run.filePosition + CROSSFADE_SAMPLES,
      run.filePosition + run.length - CROSSFADE_SAMPLES,
    )
    const expected = Float32Array.from(
      speech.subarray(run.sessionSample + CROSSFADE_SAMPLES, run.sessionSample + run.length - CROSSFADE_SAMPLES),
      (value) => value / 32768,
    )
    expect(interior).toEqual(expected)
  }
}

afterEach(() => {
  openPorts.splice(0).forEach((port) => port.close())
})

test('patches a closed clip in place: same length, high-quality run interiors, matching summary', async () => {
  await recordClip('closed', opus)
  const sizeBefore = (await fileBytes('closed')).byteLength

  const { connection, outcome } = await patch('closed', 'session-1')

  expect(outcome.type).toBe('done')
  const done = outcome as Extract<PatchReply, { type: 'done' }>
  expect(done.stats.blocks).toBe(SECONDS / 5)
  expect(done.stats.confident).toBe(done.stats.blocks)
  const progress = connection.replies.filter((reply) => reply.type === 'progress')
  expect(progress.length).toBeGreaterThan(0)
  expect(progress.every((reply) => reply.summaryOnDisk)).toBe(true)
  expect(progress.at(-1)!.heldFrames).toBe(0)

  const patched = await fileSamples('closed')
  expect(patched.byteLength).toBe(sizeBefore)
  let covered = 0
  for (const run of done.runs) {
    expect(Math.abs(run.filePosition - run.sessionSample - DELAY)).toBeLessThanOrEqual(2)
    covered += run.length
  }
  expect(covered / speech.length).toBeGreaterThanOrEqual(0.95)
  expectRunInteriorsEqualSpeech(patched, done.runs)

  const freshFile = new MemoryBackedFileSystemSyncAccessHandle('fresh')
  const fresh = new Summary(1)
  fresh.setSyncFileHandle(freshFile)
  fresh.summarizeInterleavedData(patched, patched.length)
  fresh.finishSummarizing()
  expect(await fileBytes('closed_summary')).toEqual(new Uint8Array(await (await freshFile.getFile()).arrayBuffer()))
}, 30000)

test('a second identical run places the same runs and rewrites nothing but the crossfades', async () => {
  await recordClip('twice', opus)
  const first = (await patch('twice', 'first')).outcome as Extract<PatchReply, { type: 'done' }>
  const once = await fileSamples('twice')

  const second = (await patch('twice', 'second')).outcome as Extract<PatchReply, { type: 'done' }>
  const twice = await fileSamples('twice')

  expect(second.type).toBe('done')
  expect(second.runs).toEqual(first.runs)
  // Mixing a ramp again moves its samples further towards the high-quality audio; everything else is untouched.
  const inRamp = (position: number) =>
    first.runs.some(
      (run) =>
        (position >= run.filePosition && position < run.filePosition + CROSSFADE_SAMPLES) ||
        (position >= run.filePosition + run.length - CROSSFADE_SAMPLES && position < run.filePosition + run.length),
    )
  const changed = new Array<number>()
  for (let position = 0; position < once.length; ++position) {
    if (once[position] !== twice[position] && !inRamp(position)) changed.push(position)
  }
  expect(changed).toEqual([])
}, 30000)

test('a deleted clip fails with NotFoundError without recreating its files', async () => {
  await recordClip('deleted', opus.subarray(0, HQ_SAMPLE_RATE))
  await FileSystemUtils.deleteFile(DIRNAME, 'deleted')
  await FileSystemUtils.deleteFile(DIRNAME, 'deleted_summary')

  const { outcome } = await patch('deleted', 'gone')

  expect(outcome).toMatchObject({ type: 'failed', key: 'gone', name: 'NotFoundError' })
  expect(MemoryBackedFileSystem.getExistingFileHandle(DIRNAME, 'deleted')).toBeNull()
  expect(MemoryBackedFileSystem.getExistingFileHandle(DIRNAME, 'deleted_summary')).toBeNull()
})

test('pause finishes the current batch and starts no more until resume', async () => {
  await recordClip('paused', opus)
  const connection = connect()
  const paused = connection.next('paused')
  sendSession(connection, 'held', 'paused', opus.length)
  connection.send({ type: 'pause' })
  await paused
  const repliesWhilePaused = connection.replies.length
  // Batches are timer macrotasks; several turns would have run some had the pause not held them.
  for (let turn = 0; turn < 10; ++turn) await new Promise((resolve) => setImmediate(resolve))
  expect(connection.replies.length).toBe(repliesWhilePaused)

  const done = connection.next('done')
  connection.send({ type: 'resume' })
  expect((await done).key).toBe('held')
}, 30000)

test('a recording in progress is patched through its writer, updating the shared summary in memory', async () => {
  const recording = await recordClip('live', opus, `${DIRNAME}/live`)
  const connection = connect()
  const done = connection.next('done')
  sendSession(connection, 'live-session', 'live', opus.length)
  const result = await done

  const progress = connection.replies.filter((reply) => reply.type === 'progress')
  expect(progress.every((reply) => !reply.summaryOnDisk)).toBe(true)
  const patched = await fileSamples('live')
  expectRunInteriorsEqualSpeech(patched, result.runs)
  const expected = Summary.computeBuckets(patched, 1)
  const inMemory = recording.summary.getSummaryOfRange(0, patched.length, Summary.SAMPLES_PER_SUMMARY)[0]
  const toFloat = (value: number) => (value > 0 ? value / (2 ** 15 - 1) : value / 2 ** 15)
  expect(inMemory).toEqual(Array.from(expected, toFloat))

  await recording.finish()
  const freshFile = new MemoryBackedFileSystemSyncAccessHandle('fresh-live')
  const fresh = new Summary(1)
  fresh.setSyncFileHandle(freshFile)
  fresh.summarizeInterleavedData(patched, patched.length)
  fresh.finishSummarizing()
  expect(await fileBytes('live_summary')).toEqual(new Uint8Array(await (await freshFile.getFile()).arrayBuffer()))
}, 30000)
