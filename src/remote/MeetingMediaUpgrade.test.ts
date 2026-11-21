import 'fake-indexeddb/auto'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { CloudFile, CloudProviderId, CloudStorage } from '../backup/CloudStorage'
import { contentHash } from '../backup/ContentHasher'
import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import { GlobalSettings } from '../global/GlobalSettings'
import { Clip } from '../project/Clip'
import type { MeetingMediaSession } from '../project/MeetingMedia'
import type { Project } from '../project/Project'
import { ProjectManager } from '../project/ProjectManager'
import type { VideoSegment } from '../project/Video'
import { attachPatchPort } from '../recording/HighQualityPatchService'
import { withUpgradesPaused } from '../recording/UnsettledRecordings'
import {
  HQ_AUDIO_CHUNK_FRAMES,
  HQ_AUDIO_CHUNK_HEADER_BYTES,
  HQ_FRAME_BYTES,
  HQ_FRAME_SAMPLES,
  HQ_SAMPLE_RATE,
} from './HighQualityAudioFormat'
import type { RemuxRequest } from './MeetingMediaRemux'
import {
  clampSegment,
  HQ_STALE_UPLOAD_MS,
  MeetingMediaUpgrades,
  parseManifest,
  type UpgradeDependencies,
} from './MeetingMediaUpgrade'

const notifications = vi.hoisted(() => ({
  long: vi.fn<(message: string) => void>(),
  error: vi.fn<(message: string) => void>(),
}))
vi.mock('../ui/NotificationsController', () => ({
  NotificationsController: { showLongDurationMessage: notifications.long, showErrorMessage: notifications.error },
}))
vi.mock('../audiocontext/AudioControl', () => ({ AudioControl: { stop: async () => {} } }))

GlobalSettings.useMemoryFS = true

const DELAY = 7321
const SESSION_FRAMES = 400
const SESSION_SAMPLES = SESSION_FRAMES * HQ_FRAME_SAMPLES
const CLIP_SAMPLES = SESSION_SAMPLES + DELAY + 2 * HQ_SAMPLE_RATE
const FOLDER = '/Meeting media/Call 2026/Guest 12345678'
const SESSION_ID = '12345678-session'

const directories = new Set<string>()
const ports = new Array<MessagePort>()

beforeEach(() => {
  // The patch client asks the track list on window to redraw.
  vi.stubGlobal('window', {})
  notifications.long.mockClear()
  notifications.error.mockClear()
})

afterEach(async () => {
  vi.unstubAllGlobals()
  ports.splice(0).forEach((port) => port.close())
  for (const directory of directories) await FileSystemUtils.deleteDirectory(directory)
  directories.clear()
})

/** Seeded noise in syllable-like bursts: distinctive enough to align, quiet enough for int16. */
function speech(length: number): Float32Array {
  const samples = new Float32Array(length)
  let state = 12345
  for (let index = 0; index < length; ++index) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    const envelope = 0.15 + 0.15 * Math.sin((2 * Math.PI * 3 * index) / HQ_SAMPLE_RATE) ** 2
    samples[index] = envelope * ((state >>> 0) / 2 ** 32 - 0.5)
  }
  return samples
}

const SPEECH = speech(SESSION_SAMPLES)
/** The HQ audio as the guest's int16 frames, and back as the floats the patch writes. */
const HQ_INT16 = Int16Array.from(SPEECH, (sample) => Math.round(sample * 32767))

/** The recorder's call recording of the guest: the speech delayed, at half level. */
function callAudio(): Float32Array<ArrayBuffer> {
  const samples = new Float32Array(CLIP_SAMPLES)
  for (let index = 0; index < SESSION_SAMPLES; ++index) samples[DELAY + index] = 0.5 * SPEECH[index]
  return samples
}

function audioChunk(firstSeq: number, frameCount: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(HQ_AUDIO_CHUNK_HEADER_BYTES + frameCount * HQ_FRAME_BYTES)
  const view = new DataView(bytes.buffer)
  bytes.set([...'SEHQ'].map((character) => character.charCodeAt(0)))
  view.setUint16(4, 1, true)
  view.setUint32(8, firstSeq, true)
  view.setUint32(12, frameCount, true)
  const samples = HQ_INT16.subarray(firstSeq * HQ_FRAME_SAMPLES, (firstSeq + frameCount) * HQ_FRAME_SAMPLES)
  bytes.set(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength), HQ_AUDIO_CHUNK_HEADER_BYTES)
  return bytes
}

/** An in-memory bucket; `listsHashes` is Dropbox's behaviour, S3 lists none. */
class FakeStorage implements Partial<CloudStorage> {
  readonly files = new Map<string, Uint8Array<ArrayBuffer>>()
  readonly reads = new Array<string>()

  constructor(
    readonly provider: CloudProviderId,
    private readonly listsHashes: boolean,
  ) {}

  async listFiles(folder: string): Promise<CloudFile[] | null> {
    const files = new Array<CloudFile>()
    for (const [path, bytes] of this.files) {
      if (!path.startsWith(`${folder}/`)) continue
      files.push({
        name: path.slice(folder.length + 1),
        size: bytes.length,
        contentHash: this.listsHashes ? await contentHash(bytes) : null,
      })
    }
    return files.length > 0 ? files : null
  }

  async readFile(path: string): Promise<ReadableStream<Uint8Array> | null> {
    this.reads.push(path)
    const bytes = this.files.get(path)
    return bytes ? new Response(bytes.slice()).body : null
  }
}

/** Uploads a session as the guest would: audio chunks, optional video chunks, then the manifest. */
async function upload(
  storage: FakeStorage,
  options: { complete?: boolean; video?: Uint8Array<ArrayBuffer> | null; corruptAudio?: number } = {},
) {
  const audio = []
  for (let firstSeq = 0, ordinal = 1; firstSeq < SESSION_FRAMES; firstSeq += HQ_AUDIO_CHUNK_FRAMES, ++ordinal) {
    const frameCount = Math.min(HQ_AUDIO_CHUNK_FRAMES, SESSION_FRAMES - firstSeq)
    const bytes = audioChunk(firstSeq, frameCount)
    const name = `audio-${String(ordinal).padStart(5, '0')}.pcm`
    const hash = await contentHash(bytes)
    if (options.corruptAudio == ordinal) bytes[bytes.length - 1] ^= 0xff
    storage.files.set(`${FOLDER}/${name}`, bytes)
    audio.push({ name, firstSeq, frameCount, size: bytes.length, contentHash: hash })
  }
  let video = null
  if (options.video) {
    storage.files.set(`${FOLDER}/video-00001.part`, options.video)
    const chunk = {
      name: 'video-00001.part',
      size: options.video.length,
      contentHash: await contentHash(options.video),
    }
    video = { codec: 'avc', size: options.video.length, chunks: [chunk] }
  }
  const manifest = {
    format: 'soundetch-meeting-media',
    version: 1,
    sessionId: SESSION_ID,
    frameCount: SESSION_FRAMES,
    audio,
    video,
    complete: options.complete ?? true,
  }
  storage.files.set(`${FOLDER}/manifest.json`, new TextEncoder().encode(JSON.stringify(manifest)))
}

async function writeFile(directory: string, name: string, bytes: Uint8Array<ArrayBuffer>) {
  const writer = await FileSystemUtils.createFileWriter(directory, name)
  await writer.write(bytes)
  await writer.close()
}

/** A recorded guest clip with its call audio, a summary, a call video, and one pending cloud session. */
async function createRecording(provider: CloudProviderId): Promise<{ project: Project; clip: Clip }> {
  const project = await ProjectManager.createProject('Meeting', HQ_SAMPLE_RATE)
  directories.add(project.directoryName)
  const clip = new Clip('Guest', 1, CLIP_SAMPLES)
  const session: MeetingMediaSession = {
    sessionId: SESSION_ID,
    provider,
    folder: FOLDER,
    priorFrame: 0,
    segmentStart: 0,
    segmentEnd: CLIP_SAMPLES,
  }
  clip.meetingMedia = { username: 'Guest', sessions: [session], audio: 'pending', video: 'pending' }
  clip.videoLength = CLIP_SAMPLES
  clip.videoSegments = [
    { index: 0, trackNumber: 1, startSample: 0, length: CLIP_SAMPLES, mediaStartSeconds: 0, mimeType: 'video/mp4' },
  ]
  await ProjectManager.addNewClip(clip)
  const audio = callAudio()
  await writeFile(project.directoryName, clip.filename, new Uint8Array(audio.buffer))
  await writeFile(project.directoryName, `${clip.filename}_summary`, new Uint8Array(Math.ceil(CLIP_SAMPLES / 256) * 4))
  await writeFile(project.directoryName, `${clip.filename}_video_0`, new Uint8Array(1000))
  return { project, clip }
}

function dependencies(storage: FakeStorage, overrides: Partial<UpgradeDependencies> = {}) {
  let clock = 0
  const deps = {
    getStorage: () => storage as unknown as CloudStorage,
    isConnected: async () => true,
    openPatchPort: vi.fn(async () => {
      const { port1, port2 } = new MessageChannel()
      attachPatchPort(port2)
      ports.push(port1, port2)
      return port1
    }),
    remux: vi.fn<(request: RemuxRequest) => Promise<VideoSegment>>(async () => {
      throw new Error('unexpected remux')
    }),
    isProjectOpen: async () => true,
    freeStorageBytes: async () => null,
    now: () => clock,
    sleep: async (milliseconds: number) => {
      clock += milliseconds
    },
    ...overrides,
  }
  return deps
}

async function readClipAudio(project: Project, clip: Clip): Promise<Float32Array> {
  return new Float32Array(
    await (await FileSystemUtils.getExistingFile(project.directoryName, clip.filename)).arrayBuffer(),
  )
}

/** The largest difference from the HQ audio over session samples `[start, end)`, at their aligned file positions. */
function errorAgainstHq(audio: Float32Array, start: number, end: number, scale = 1): number {
  let error = 0
  for (let index = start; index < end; ++index) {
    error = Math.max(error, Math.abs(audio[DELAY + index] - (scale * HQ_INT16[index]) / 32767))
  }
  return error
}

test('an uploaded session patches the clip audio in place and marks it done', { timeout: 60_000 }, async () => {
  const storage = new FakeStorage('dropbox', true)
  await upload(storage)
  const { project, clip } = await createRecording('dropbox')

  await new MeetingMediaUpgrades(dependencies(storage)).schedule(project, clip)

  expect(notifications.error).not.toHaveBeenCalled()
  expect(clip.meetingMedia!.audio).toBe('done')
  // Audio-only upload: the call video stays.
  expect(clip.meetingMedia!.video).toBe('kept')
  expect(clip.videoSegments.map((segment) => segment.index)).toEqual([0])
  expect(notifications.long).toHaveBeenCalledWith(expect.stringMatching(/^Upgraded Guest's recording to high-quality/))
  const audio = await readClipAudio(project, clip)
  expect(errorAgainstHq(audio, 5 * HQ_SAMPLE_RATE, 35 * HQ_SAMPLE_RATE)).toBeLessThan(1e-3)
  const saved = await ProjectManager.getActiveProject()
  const savedMedia = saved.getClips().find((candidate) => candidate.id == clip.id)?.meetingMedia
  expect(savedMedia?.audio).toBe('done')
  // Saved for the video step, which must not patch the audio a second time.
  const runs = savedMedia!.sessions[0].runs!
  expect(runs.length).toBeGreaterThan(0)
  expect(Math.abs(runs[0].filePosition - runs[0].sessionSample - DELAY)).toBeLessThanOrEqual(2)
})

test('a chunk whose content hash does not match the manifest is skipped', { timeout: 60_000 }, async () => {
  const storage = new FakeStorage('s3', false)
  await upload(storage, { corruptAudio: 2 })
  const { project, clip } = await createRecording('s3')

  await new MeetingMediaUpgrades(dependencies(storage)).schedule(project, clip)

  expect(clip.meetingMedia!.audio).toBe('done')
  const audio = await readClipAudio(project, clip)
  expect(errorAgainstHq(audio, 5 * HQ_SAMPLE_RATE, 25 * HQ_SAMPLE_RATE)).toBeLessThan(1e-3)
  // The second chunk's 10 s stay the call audio.
  const secondChunk = HQ_AUDIO_CHUNK_FRAMES * HQ_FRAME_SAMPLES
  expect(errorAgainstHq(audio, secondChunk + HQ_SAMPLE_RATE, SESSION_SAMPLES, 0.5)).toBeLessThan(1e-4)
})

test('a missing folder keeps the recording once the session went stale', async () => {
  const storage = new FakeStorage('dropbox', true)
  const { project, clip } = await createRecording('dropbox')
  const deps = dependencies(storage)
  const sleep = vi.spyOn(deps, 'sleep')

  await new MeetingMediaUpgrades(deps).schedule(project, clip)

  expect(sleep.mock.calls.reduce((total, [milliseconds]) => total + milliseconds, 0)).toBeGreaterThanOrEqual(
    HQ_STALE_UPLOAD_MS,
  )
  expect(clip.meetingMedia).toMatchObject({ audio: 'done', video: 'kept' })
  expect(clip.videoSegments.map((segment) => segment.index)).toEqual([0])
  expect(deps.openPatchPort).not.toHaveBeenCalled()
  expect(notifications.long).toHaveBeenCalledWith(
    "Guest's high-quality media is no longer in Dropbox; kept the recording as is.",
  )
})

test('a live session is waited for until the guest reports it final', async () => {
  const storage = new FakeStorage('dropbox', true)
  const { project, clip } = await createRecording('dropbox')
  let final = false
  const deps = dependencies(storage, {
    sleep: async () => {
      // The guest finishes uploading while the run waits.
      if (!final) await upload(storage, { complete: false })
      final = true
    },
  })
  const liveSessions = { isLive: () => true, isFinal: () => final }

  await new MeetingMediaUpgrades(deps).schedule(project, clip, { liveSessions })

  expect(final).toBe(true)
  expect(clip.meetingMedia!.audio).toBe('done')
})

test('a run waits while upgrades are paused and continues on resume', { timeout: 60_000 }, async () => {
  const storage = new FakeStorage('dropbox', true)
  await upload(storage)
  const { project, clip } = await createRecording('dropbox')
  const deps = dependencies(storage)
  let done: Promise<void> | null = null

  await withUpgradesPaused(async () => {
    done = new MeetingMediaUpgrades(deps).schedule(project, clip)
    await vi.waitFor(() => expect(storage.reads).toContain(`${FOLDER}/manifest.json`))
    // A paused run signals nothing, so its absence of progress can only be shown by letting time pass.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(deps.openPatchPort).not.toHaveBeenCalled()
    expect(clip.meetingMedia!.audio).toBe('pending')
  })
  await done

  expect(clip.meetingMedia!.audio).toBe('done')
})

test('video stays when the audio was upgraded without saving its alignment', async () => {
  const storage = new FakeStorage('dropbox', true)
  await upload(storage, { video: new Uint8Array(5000) })
  const { project, clip } = await createRecording('dropbox')
  clip.meetingMedia!.audio = 'done'
  const deps = dependencies(storage)

  await new MeetingMediaUpgrades(deps).schedule(project, clip)

  expect(clip.meetingMedia).toMatchObject({ audio: 'done', video: 'kept' })
  expect(deps.openPatchPort).not.toHaveBeenCalled()
  expect(deps.remux).not.toHaveBeenCalled()
  expect(clip.videoSegments.map((segment) => segment.index)).toEqual([0])
})

test('video stays when the manifest is incomplete', { timeout: 60_000 }, async () => {
  const storage = new FakeStorage('dropbox', true)
  await upload(storage, { complete: false, video: new Uint8Array(5000) })
  const { project, clip } = await createRecording('dropbox')
  const deps = dependencies(storage)

  await new MeetingMediaUpgrades(deps).schedule(project, clip)

  expect(clip.meetingMedia).toMatchObject({ audio: 'done', video: 'kept' })
  expect(deps.remux).not.toHaveBeenCalled()
  expect(clip.videoSegments.map((segment) => segment.index)).toEqual([0])
  expect(await FileSystemUtils.getExistingFile(project.directoryName, `${clip.filename}_video_0`)).toBeDefined()
})

test('a complete upload replaces the call video with the remuxed one', { timeout: 60_000 }, async () => {
  const video = new Uint8Array(5000).map((_, index) => index % 251)
  const storage = new FakeStorage('s3', false)
  await upload(storage, { video })
  const { project, clip } = await createRecording('s3')
  const deps = dependencies(storage, {
    remux: vi.fn(async (request: RemuxRequest) => {
      expect(request.runs.length).toBeGreaterThan(0)
      expect(await request.readChunk(0)).toEqual(video)
      await writeFile(request.dirname, request.filename, new Uint8Array(video))
      // Starts before the segment and ends after it: clamped to the session's segment.
      return {
        index: 0,
        trackNumber: 1,
        startSample: -480,
        length: CLIP_SAMPLES + 960,
        mediaStartSeconds: 0,
        mimeType: 'video/mp4',
      }
    }),
  })

  await new MeetingMediaUpgrades(deps).schedule(project, clip)

  expect(notifications.error).not.toHaveBeenCalled()
  expect(clip.meetingMedia).toMatchObject({ audio: 'done', video: 'done' })
  expect(clip.videoSegments).toEqual([
    { index: 1, trackNumber: 1, startSample: 0, length: CLIP_SAMPLES, mediaStartSeconds: 0.01, mimeType: 'video/mp4' },
  ])
  expect(clip.videoLength).toBe(CLIP_SAMPLES)
  await expect(FileSystemUtils.getExistingFile(project.directoryName, `${clip.filename}_video_0`)).rejects.toThrow()
  const replaced = await FileSystemUtils.getExistingFile(project.directoryName, `${clip.filename}_video_1`)
  expect(replaced.size).toBe(video.length)
  // S3 lists no hashes: the video was hashed once before deleting, then read again for the remux.
  expect(storage.reads.filter((path) => path.endsWith('video-00001.part'))).toHaveLength(2)
})

test('a failed remux leaves the clip replacing and reports where the video is safe', { timeout: 60_000 }, async () => {
  const storage = new FakeStorage('dropbox', true)
  await upload(storage, { video: new Uint8Array(5000) })
  const { project, clip } = await createRecording('dropbox')
  const deps = dependencies(storage, {
    remux: vi.fn(async (request: RemuxRequest) => {
      await writeFile(request.dirname, request.filename, new Uint8Array(10))
      throw new Error('the decoder failed')
    }),
  })

  await new MeetingMediaUpgrades(deps).schedule(project, clip)

  expect(clip.meetingMedia).toMatchObject({ audio: 'done', video: 'replacing' })
  expect(clip.videoSegments).toEqual([])
  expect(clip.videoLength).toBe(CLIP_SAMPLES)
  await expect(FileSystemUtils.getExistingFile(project.directoryName, `${clip.filename}_video_1`)).rejects.toThrow()
  expect(notifications.error).toHaveBeenCalledWith(
    `Could not finish Guest's high-quality video: the decoder failed. It is safe in Dropbox under ${FOLDER}; use Finish high-quality upgrade to retry.`,
  )
})

test('a disconnected provider is reported once per provider on resume', async () => {
  const storage = new FakeStorage('dropbox', true)
  const { project } = await createRecording('dropbox')
  const deps = dependencies(storage, { isConnected: async () => false })

  await new MeetingMediaUpgrades(deps).resume(project)

  expect(notifications.long).toHaveBeenCalledExactlyOnceWith('Connect Dropbox to finish upgrading Guest.')
  expect(deps.openPatchPort).not.toHaveBeenCalled()
})

test('parseManifest rejects other sessions and inconsistent video chunks', () => {
  const manifest = {
    format: 'soundetch-meeting-media',
    version: 1,
    sessionId: 's',
    frameCount: 10,
    audio: [{ name: 'audio-00001.pcm', firstSeq: 0, frameCount: 10, size: 96016, contentHash: 'h' }],
    video: { codec: 'avc', size: 100, chunks: [{ name: 'video-00001.part', size: 100, contentHash: 'v' }] },
    complete: true,
  }
  expect(parseManifest(manifest, 's')?.video?.size).toBe(100)
  expect(parseManifest(manifest, 'other')).toBeNull()
  expect(parseManifest({ ...manifest, video: { ...manifest.video, size: 101 } }, 's')).toBeNull()
  expect(parseManifest({ ...manifest, audio: [{ ...manifest.audio[0], name: '../x' }] }, 's')).toBeNull()
})

test('clampSegment trims to the session segment and drops what lies outside', () => {
  const segment = {
    index: 1,
    trackNumber: 1,
    startSample: 100,
    length: 1000,
    mediaStartSeconds: 2,
    mimeType: 'video/mp4',
  }
  expect(clampSegment(segment, 580, 900, 48000)).toEqual({
    ...segment,
    startSample: 580,
    length: 320,
    mediaStartSeconds: 2.01,
  })
  expect(clampSegment(segment, 1100, 2000, 48000)).toBeNull()
})
