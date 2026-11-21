import 'fake-indexeddb/auto'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import { GlobalSettings } from '../global/GlobalSettings'
import { Summary } from '../project/Summary'
import { attachPatchPort } from '../recording/HighQualityPatchService'
import { AudioControl, AudioState } from '../audiocontext/AudioControl'
import { CloudAuthorizationError, type CloudProviderId, type UploadLink } from '../backup/CloudStorage'
import { Clip } from '../project/Clip'
import type { Project } from '../project/Project'
import { RecordingSessions } from '../recording/RecordingSessions'
import { withUpgradesPaused } from '../recording/UnsettledRecordings'
import { HQ_FRAME_BYTES, HQ_FRAME_SAMPLES, HQ_MAX_FRAME_SEQ } from './HighQualityAudioFormat'
import {
  HighQualityMediaReceiver,
  HQ_LINK_DURATION_SECONDS,
  HQ_OFFER_TIMEOUT_MS,
  type HighQualityMediaReceiverDeps,
  type HighQualityReceiverClient,
} from './HighQualityMediaReceiver'
import type { PatchHandlers } from './HighQualityPatchClient'
import type { HighQualityListener, HighQualityMessage, State, StateListener } from './RemoteMediaClient3'

const notifications = vi.hoisted(() => ({ error: vi.fn(), long: vi.fn() }))
vi.mock('../ui/NotificationsController', () => ({
  NotificationsController: { showErrorMessage: notifications.error, showLongDurationMessage: notifications.long },
}))
// The real AudioControl extends AudioContext, which node lacks; the receiver needs only its listeners.
vi.mock('../audiocontext/AudioControl', () => {
  const AudioState = { RECORDING: 'recording', RECORDING_PAUSED: 'recordingPaused', STOPPED: 'stopped' }
  const AudioControl = {
    audioControlListeners: new Array<(state: string) => void>(),
    addAudioControlListener(listener: (state: string) => void) {
      AudioControl.audioControlListeners.push(listener)
      listener(AudioState.STOPPED)
    },
    stop: async () => {},
  }
  return { AudioControl, AudioState }
})

const DIRNAME = '12'

class FakeClient {
  readonly sent = new Array<{ peerId: string; message: HighQualityMessage }>()
  private stateListener: StateListener | null = null
  private highQualityListener: HighQualityListener | null = null
  private members = new Map<string, string>()

  constructor(members: Record<string, string>) {
    this.members = new Map(Object.entries(members))
  }

  addStateListener(listener: StateListener) {
    this.stateListener = listener
    listener(this.state())
  }

  addHighQualityListener(listener: HighQualityListener) {
    this.highQualityListener = listener
  }

  sendHighQuality(peerId: string, message: HighQualityMessage): boolean {
    if (!this.members.has(peerId)) return false
    this.sent.push({ peerId, message })
    return true
  }

  receive(peerId: string, message: unknown) {
    this.highQualityListener!(peerId, message as HighQualityMessage)
  }

  leave(peerId: string) {
    this.members.delete(peerId)
    this.stateListener!(this.state())
  }

  /** Removes and returns the sent messages of `type`, optionally only those to `peerId`. */
  take<T extends HighQualityMessage['type']>(
    type: T,
    peerId?: string,
  ): Array<{ peerId: string } & Extract<HighQualityMessage, { type: T }>> {
    const matches = (entry: { peerId: string; message: HighQualityMessage }) =>
      entry.message.type == type && (peerId == null || entry.peerId == peerId)
    const taken = this.sent.filter(matches)
    this.sent.splice(0, this.sent.length, ...this.sent.filter((entry) => !matches(entry)))
    return taken.map(({ peerId, message }) => ({ peerId, ...(message as Extract<HighQualityMessage, { type: T }>) }))
  }

  private state(): State {
    return {
      members: Array.from(this.members, ([peerId, username]) => ({
        peerId,
        username,
        mediaStream: null as unknown as MediaStream,
        error: null,
        recordingActivity: { state: 'idle', countdownId: null },
      })),
      roomId: 'room',
      isHost: true,
      hostUsername: 'A',
      waitingForHost: false,
      joinRequests: [],
      screenShare: null,
      error: null,
    }
  }
}

class FakePatchClient {
  readonly calls = new Array<[string, ...unknown[]]>()
  readonly handlers = new Map<string, PatchHandlers>()
  paused = false
  closed = false

  open(options: { key: string }, handlers: PatchHandlers) {
    this.calls.push(['open', options])
    this.handlers.set(options.key, handlers)
  }
  frames(key: string, firstSeq: number, pcm: ArrayBuffer) {
    this.calls.push(['frames', key, firstSeq, pcm.byteLength])
  }
  segmentEnd(key: string, end: number) {
    this.calls.push(['segmentEnd', key, end])
  }
  finish(key: string, frameCount: number) {
    this.calls.push(['finish', key, frameCount])
  }
  abort(key: string) {
    this.calls.push(['abort', key])
  }
  async pause() {
    this.paused = true
  }
  resume() {
    this.paused = false
  }
  close() {
    this.closed = true
  }
  of(type: string) {
    return this.calls.filter((call) => call[0] == type).map((call) => call.slice(1))
  }
}

function makeClip(id: number, length: number, channelCount = 1): Clip {
  const clip = new Clip(`clip ${id}`, channelCount, length)
  Object.assign(clip, { id })
  return clip
}

let client: FakeClient
let patch: FakePatchClient
let receiver: HighQualityMediaReceiver
let providerConnected: boolean
let createUploadLink: ReturnType<typeof vi.fn<(path: string, seconds: number) => Promise<UploadLink>>>
let deps: HighQualityMediaReceiverDeps
let finishRecording: () => void
const unattachedPort = () => new MessageChannel().port1
let openPatchPort: () => MessagePort = unattachedPort

function setAudioState(state: AudioState) {
  AudioControl.audioControlListeners.forEach((listener) => listener(state))
}

async function flush() {
  if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0)
  // The end-to-end test runs on real timers: the patch service answers over a real MessageChannel.
  else await new Promise((resolve) => setTimeout(resolve, 0))
}

function frame(bytes = HQ_FRAME_BYTES): ArrayBuffer {
  return new ArrayBuffer(bytes)
}

/** Publishes a recording of `clips` (peer id → clip) with the recorder already recording. */
async function startRecording(clips: Record<string, Clip>) {
  const { promise, resolve } = Promise.withResolvers<void>()
  finishRecording = resolve
  setAudioState(AudioState.RECORDING)
  RecordingSessions.publish({
    dirname: DIRNAME,
    clipsByInputId: new Map(Object.entries(clips)),
    finished: promise,
    openPatchPort: () => openPatchPort(),
  })
  await flush()
}

async function acceptOffer(peerId: string) {
  const [offer] = client.take('hqOffer', peerId)
  client.receive(peerId, { type: 'hqAccept', sessionId: offer.sessionId })
  await flush()
  return offer
}

beforeEach(() => {
  vi.useFakeTimers()
  notifications.error.mockReset()
  notifications.long.mockReset()
  providerConnected = false
  client = new FakeClient({ b: 'Bea', c: 'Cy' })
  patch = new FakePatchClient()
  createUploadLink = vi.fn(async (path: string) => ({
    method: 'POST' as const,
    url: `https://upload/${path}`,
    singleUse: true,
  }))
  deps = {
    createPatchClient: () => patch,
    getSelectedProvider: async () => 'dropbox' as CloudProviderId,
    isProviderConnected: async () => providerConnected,
    getCloudStorage: () => ({ createUploadLink }),
    getProject: async () => ({ title: 'Weekly: call?', directoryName: DIRNAME }) as Project,
    saveClip: vi.fn(async () => {}),
    scheduleUpgrade: vi.fn(async () => {}),
  }
  receiver = new HighQualityMediaReceiver(client as unknown as HighQualityReceiverClient, deps)
})

afterEach(() => {
  receiver.dispose()
  setAudioState(AudioState.STOPPED)
  vi.useRealTimers()
})

test('offers each mono member clip the peer transport without a connected cloud, with video per clip', async () => {
  const b = makeClip(1, 0)
  b.videoRecordingInProgress = true
  await startRecording({ b, c: makeClip(2, 0), stranger: makeClip(3, 0), 'b-screen': makeClip(4, 0) })

  const offers = client.take('hqOffer')
  expect(offers.map(({ peerId, transport, video }) => ({ peerId, transport, video }))).toEqual([
    { peerId: 'b', transport: 'peer', video: true },
    { peerId: 'c', transport: 'peer', video: false },
  ])
})

test('skips stereo clips and offers the cloud transport when the selected provider is connected', async () => {
  providerConnected = true
  await startRecording({ b: makeClip(1, 0), c: makeClip(2, 0, 2) })

  const offers = client.take('hqOffer')
  expect(offers.map(({ peerId, transport }) => ({ peerId, transport }))).toEqual([{ peerId: 'b', transport: 'cloud' }])
})

test('validates peer frames: size, seq range, session and sender', async () => {
  await startRecording({ b: makeClip(1, 0), c: makeClip(2, 0) })
  const offer = await acceptOffer('b')
  const sessionId = offer.sessionId
  expect(patch.of('open')).toEqual([[expect.objectContaining({ key: sessionId, dirname: DIRNAME, priorFrame: 0 })]])

  client.receive('b', { type: 'hqFrame', sessionId, seq: 0, pcm: frame() })
  client.receive('b', { type: 'hqFrame', sessionId, seq: 0, pcm: frame() }) // duplicate
  client.receive('b', { type: 'hqFrame', sessionId, seq: 1, pcm: frame(HQ_FRAME_BYTES + 2) }) // oversized
  client.receive('b', { type: 'hqFrame', sessionId, seq: 2, pcm: 'pcm' })
  client.receive('b', { type: 'hqFrame', sessionId, seq: -1, pcm: frame() })
  client.receive('b', { type: 'hqFrame', sessionId, seq: 1.5, pcm: frame() })
  client.receive('b', { type: 'hqFrame', sessionId, seq: HQ_MAX_FRAME_SEQ + 1, pcm: frame() })
  client.receive('b', { type: 'hqFrame', sessionId: 'unknown', seq: 3, pcm: frame() })
  client.receive('c', { type: 'hqFrame', sessionId, seq: 4, pcm: frame() }) // another member's message
  client.receive('b', null)
  // peerjs delivers split messages as views into a larger buffer.
  const view = new Uint8Array(HQ_FRAME_BYTES + 8).subarray(4, 4 + HQ_FRAME_BYTES)
  client.receive('b', { type: 'hqFrame', sessionId, seq: HQ_MAX_FRAME_SEQ, pcm: view })

  expect(patch.of('frames')).toEqual([
    [sessionId, 0, HQ_FRAME_BYTES],
    [sessionId, HQ_MAX_FRAME_SEQ, HQ_FRAME_BYTES],
  ])

  client.receive('b', { type: 'hqEnd', sessionId, frameCount: 2.5, sentCount: 1 })
  client.receive('b', { type: 'hqEnd', sessionId, frameCount: 1, sentCount: HQ_MAX_FRAME_SEQ + 1 })
  expect(patch.of('finish')).toEqual([])
})

test('a peer session finishes once every sent frame arrived, then reports the upgrade after the recording', async () => {
  const b = makeClip(1, 0)
  await startRecording({ b })
  const { sessionId } = await acceptOffer('b')

  client.receive('b', { type: 'hqFrame', sessionId, seq: 0, pcm: frame() })
  client.receive('b', { type: 'hqFrame', sessionId, seq: 2, pcm: frame() })
  client.receive('b', { type: 'hqEnd', sessionId, frameCount: 4, sentCount: 3 })
  expect(patch.of('finish')).toEqual([])
  client.receive('b', { type: 'hqFrame', sessionId, seq: 1, pcm: frame() })
  expect(patch.of('finish')).toEqual([[sessionId, 4]])

  b.length = 48000
  finishRecording()
  await flush()
  expect(patch.closed).toBe(false)
  patch.handlers.get(sessionId)!.onDone({ stats: { blocks: 1, confident: 1, hqSamples: 36000 }, runs: [] })
  expect(notifications.long).toHaveBeenCalledWith(
    "Upgraded Bea's recording to high-quality audio (75% of the recording).",
  )
  expect(patch.closed).toBe(true)
})

test('a departing peer finishes its session with what arrived', async () => {
  await startRecording({ b: makeClip(1, 0), c: makeClip(2, 0) })
  const { sessionId } = await acceptOffer('b')
  for (let seq = 0; seq < 5; ++seq) client.receive('b', { type: 'hqFrame', sessionId, seq, pcm: frame() })

  client.leave('b')
  expect(patch.of('finish')).toEqual([[sessionId, 5]])
  client.receive('b', { type: 'hqFrame', sessionId, seq: 5, pcm: frame() })
  expect(patch.of('frames')).toHaveLength(5)

  finishRecording()
  await flush()
  patch.handlers.get(sessionId)!.onDone({ stats: { blocks: 0, confident: 0, hqSamples: 0 }, runs: [] })
  expect(notifications.long).toHaveBeenCalledWith('No usable high-quality audio arrived from Bea; kept the call audio.')
})

test('a pause ends the segment; busy peers wait for the resume, which offers again', async () => {
  const b = makeClip(1, 0)
  const c = makeClip(2, 0)
  await startRecording({ b, c })
  const { sessionId } = await acceptOffer('b')
  const [offerC] = client.take('hqOffer')
  client.receive('c', { type: 'hqDecline', sessionId: offerC.sessionId, reason: 'busy' })

  b.length = 96000
  c.length = 96100
  setAudioState(AudioState.RECORDING_PAUSED)
  await flush()
  expect(patch.of('segmentEnd')).toEqual([[sessionId, 96000]])
  // The guest ends its session when it sees the pause; nothing is offered while paused.
  client.receive('b', { type: 'hqEnd', sessionId, frameCount: 0, sentCount: 0 })
  expect(patch.of('finish')).toEqual([[sessionId, 0]])
  await vi.advanceTimersByTimeAsync(2000)
  expect(client.take('hqOffer')).toEqual([])

  b.length = 96200
  c.length = 96300
  setAudioState(AudioState.RECORDING)
  await flush()
  const offers = client.take('hqOffer')
  expect(offers.map((offer) => offer.peerId)).toEqual(['b', 'c'])
  expect(offers[0].sessionId).not.toBe(sessionId)
  await (async () => {
    client.receive('b', { type: 'hqAccept', sessionId: offers[0].sessionId })
    await flush()
  })()
  expect(patch.of('open')[1]).toEqual([expect.objectContaining({ segmentStart: 96300, priorFrame: 96200 })])
})

test('a busy peer is not offered again within the segment, but another ended session is re-offered after 1 s', async () => {
  await startRecording({ b: makeClip(1, 0), c: makeClip(2, 0) })
  const { sessionId } = await acceptOffer('b')
  const [offerC] = client.take('hqOffer')
  client.receive('c', { type: 'hqDecline', sessionId: offerC.sessionId, reason: 'busy' })

  // The guest ended its session mid-recording, e.g. because its microphone changed.
  client.receive('b', { type: 'hqEnd', sessionId, frameCount: 0, sentCount: 0 })
  await vi.advanceTimersByTimeAsync(999)
  expect(client.take('hqOffer')).toEqual([])
  await vi.advanceTimersByTimeAsync(1)
  expect(client.take('hqOffer').map((offer) => offer.peerId)).toEqual(['b'])
})

test('an unanswered offer times out; a late accept is cancelled', async () => {
  await startRecording({ b: makeClip(1, 0) })
  const [offer] = client.take('hqOffer')
  await vi.advanceTimersByTimeAsync(HQ_OFFER_TIMEOUT_MS)
  client.receive('b', { type: 'hqAccept', sessionId: offer.sessionId })
  expect(client.take('hqCancel')).toEqual([{ peerId: 'b', type: 'hqCancel', sessionId: offer.sessionId }])
  expect(patch.of('open')).toEqual([])
})

test('a cloud session is persisted on the clip and gets its links, refilled on upload', async () => {
  providerConnected = true
  const b = makeClip(1, 4800)
  await startRecording({ b })
  const { sessionId } = await acceptOffer('b')

  expect(b.meetingMedia).toEqual({
    username: 'Bea',
    audio: 'pending',
    video: 'pending',
    sessions: [
      {
        sessionId,
        provider: 'dropbox',
        folder: expect.stringMatching(
          new RegExp(
            `^/Meeting media/Weekly- call- \\d{4}-\\d\\d-\\d\\d \\d\\d\\.\\d\\d\\.\\d\\d/Bea ${sessionId.slice(0, 8)}$`,
          ),
        ),
        priorFrame: 4800,
        segmentStart: 0,
        segmentEnd: null,
      },
    ],
  })
  expect(deps.saveClip).toHaveBeenCalledWith(b)
  const folder = b.meetingMedia!.sessions[0].folder
  const [links] = client.take('hqLinks')
  expect(links.links.map((link) => link.name).sort()).toEqual([
    'audio-00001.pcm',
    'audio-00002.pcm',
    'audio-00003.pcm',
    'manifest.json',
    'video-00001.part',
    'video-00002.part',
    'video-00003.part',
  ])
  expect(links.links[0]).toEqual({
    name: links.links[0].name,
    method: 'POST',
    url: `https://upload/${folder}/${links.links[0].name}`,
  })
  expect(createUploadLink).toHaveBeenCalledWith(
    `${folder}/manifest.json`,
    HQ_LINK_DURATION_SECONDS.dropbox,
    expect.anything(),
  )

  const uploaded = { type: 'hqUploaded', sessionId, contentHash: 'ab'.repeat(32) }
  client.receive('b', { ...uploaded, name: 'audio-00001.pcm', size: 16 + 300 * 9600 + 1 }) // too large
  client.receive('b', { ...uploaded, name: 'audio-1.pcm', size: 100 })
  client.receive('b', { ...uploaded, name: 'audio-00009.pcm', size: 100 }) // never issued
  client.receive('c', { ...uploaded, name: 'audio-00001.pcm', size: 100 })
  await flush()
  expect(client.take('hqLinks')).toEqual([])
  client.receive('b', { ...uploaded, name: 'audio-00001.pcm', size: 100 })
  client.receive('b', { ...uploaded, name: 'audio-00001.pcm', size: 100 }) // repeated
  client.receive('b', { ...uploaded, name: 'video-00001.part', size: 8 * 1024 * 1024 })
  await flush()
  expect(client.take('hqLinks').flatMap((message) => message.links.map((link) => link.name))).toEqual([
    'audio-00004.pcm',
    'video-00004.part',
  ])

  client.receive('b', { type: 'hqLinkRequest', sessionId, names: ['audio-00002.pcm', 'audio-00205.pcm', '../x', 7] })
  await flush()
  expect(client.take('hqLinks').flatMap((message) => message.links.map((link) => link.name))).toEqual([
    'audio-00002.pcm',
  ])

  b.length = 96000
  finishRecording()
  await flush()
  expect(b.meetingMedia!.sessions[0].segmentEnd).toBe(96000)
  expect(deps.scheduleUpgrade).toHaveBeenCalledWith(
    expect.objectContaining({ directoryName: DIRNAME }),
    b,
    expect.objectContaining({ liveSessions: expect.anything() }),
  )
  const { liveSessions } = vi.mocked(deps.scheduleUpgrade).mock.calls[0][2]
  expect(liveSessions.isLive(sessionId)).toBe(true)
  expect(liveSessions.isFinal(sessionId)).toBe(false)
  client.receive('b', { type: 'hqComplete', sessionId })
  expect(liveSessions.isLive(sessionId)).toBe(false)
  expect(liveSessions.isFinal(sessionId)).toBe(true)
  // The guest finished after the recording stopped: the upgrade starts now rather than at its next poll.
  expect(deps.scheduleUpgrade).toHaveBeenCalledTimes(2)
})

test('issues at most 4 links at a time', async () => {
  providerConnected = true
  let running = 0
  let maxRunning = 0
  createUploadLink.mockImplementation(async (path: string) => {
    maxRunning = Math.max(maxRunning, ++running)
    await new Promise((resolve) => setTimeout(resolve, 10))
    --running
    return { method: 'POST', url: `https://upload/${path}`, singleUse: true }
  })
  await startRecording({ b: makeClip(1, 0) })
  await acceptOffer('b')
  await vi.advanceTimersByTimeAsync(100)
  expect(createUploadLink).toHaveBeenCalledTimes(7)
  expect(maxRunning).toBe(4)
  expect(client.take('hqLinks')[0].links).toHaveLength(7)
})

test('links that fail for authorization are reported once and retried every 30 s', async () => {
  providerConnected = true
  createUploadLink.mockRejectedValue(new CloudAuthorizationError('Reconnect Dropbox.'))
  await startRecording({ b: makeClip(1, 0) })
  await acceptOffer('b')
  expect(notifications.error).toHaveBeenCalledTimes(1)
  expect(notifications.error).toHaveBeenCalledWith('Reconnect Dropbox to keep receiving high-quality media from Bea.')
  expect(client.take('hqLinks')).toEqual([])

  await vi.advanceTimersByTimeAsync(30000)
  expect(notifications.error).toHaveBeenCalledTimes(1)
  createUploadLink.mockImplementation(async (path: string) => ({
    method: 'PUT',
    url: `https://s/${path}`,
    singleUse: false,
  }))
  await vi.advanceTimersByTimeAsync(30000)
  expect(client.take('hqLinks')[0].links).toHaveLength(7)
})

test('the patch client is paused with upgrades and closed when the recording work ends', async () => {
  await startRecording({ b: makeClip(1, 0) })
  await withUpgradesPaused(async () => expect(patch.paused).toBe(true))
  expect(patch.paused).toBe(false)
  const { sessionId } = await acceptOffer('b')

  receiver.dispose()
  expect(patch.of('abort')).toEqual([[sessionId]])
  expect(patch.closed).toBe(true)
  client.receive('b', { type: 'hqFrame', sessionId, seq: 0, pcm: frame() })
  expect(patch.of('frames')).toEqual([])
})

/** Speech-like test audio: lowpassed noise in syllable-rate bursts, as int16. */
function speech(length: number): Int16Array {
  const samples = new Int16Array(length)
  let state = 12345
  let lowpassed = 0
  for (let index = 0; index < length; ++index) {
    state = (state * 1103515245 + 12345) >>> 0
    lowpassed = 0.7 * lowpassed + 0.3 * (state / 2 ** 32 - 0.5)
    const envelope = Math.abs(Math.sin((2 * Math.PI * 3 * index) / 48000))
    samples[index] = Math.round(lowpassed * envelope * 40000)
  }
  return samples
}

async function writeFile(name: string, bytes: ArrayBufferView) {
  const handle = await (
    (await FileSystemUtils.getFileHandle(DIRNAME, name)) as FileSystemFileHandle & {
      createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle>
    }
  ).createSyncAccessHandle()
  handle.write(bytes, { at: 0 })
  handle.flush()
  handle.close()
}

test('peer frames upgrade the recorded clip in place through the patch service', { timeout: 30000 }, async () => {
  receiver.dispose()
  vi.useRealTimers()
  vi.stubGlobal('window', {})
  const previousMemoryFS = GlobalSettings.useMemoryFS
  GlobalSettings.useMemoryFS = true
  try {
    const frameCount = 200
    const delay = 2400
    const hq = speech(frameCount * HQ_FRAME_SAMPLES)
    // The recorder's own recording of the guest: the same speech, later, quieter and slightly noisy.
    const opus = new Float32Array(hq.length + delay)
    for (let index = 0; index < hq.length; ++index) {
      opus[index + delay] = (0.8 * hq[index]) / 32768 + 0.001 * Math.sin(index)
    }
    // The session starts with the recording, so its first frame is expected near the clip's start.
    const b = makeClip(901, 0)
    await writeFile(b.filename, opus)
    await writeFile(`${b.filename}_summary`, Summary.computeBuckets(opus, 1))
    openPatchPort = () => {
      const channel = new MessageChannel()
      attachPatchPort(channel.port2)
      return channel.port1
    }
    const { createPatchClient: _, ...realPatchDeps } = deps
    receiver = new HighQualityMediaReceiver(client as unknown as HighQualityReceiverClient, realPatchDeps)

    await startRecording({ b })
    const { sessionId } = await acceptOffer('b')
    // The recording has written everything by the time it stops.
    b.length = opus.length
    for (let seq = 0; seq < frameCount; ++seq) {
      const pcm = hq.slice(seq * HQ_FRAME_SAMPLES, (seq + 1) * HQ_FRAME_SAMPLES).buffer
      client.receive('b', { type: 'hqFrame', sessionId, seq, pcm })
    }
    client.receive('b', { type: 'hqEnd', sessionId, frameCount, sentCount: frameCount })
    finishRecording()

    await vi.waitFor(
      () => expect(notifications.long.mock.calls.length + notifications.error.mock.calls.length).toBeGreaterThan(0),
      { timeout: 20000, interval: 50 },
    )
    expect(notifications.error).not.toHaveBeenCalled()
    const [message] = notifications.long.mock.calls[0]
    expect(message).toMatch(/^Upgraded Bea's recording to high-quality audio \(\d+% of the recording\)\.$/)
    expect(Number(/\((\d+)%/.exec(message)![1])).toBeGreaterThanOrEqual(50)
    const patched = new Float32Array(await (await FileSystemUtils.getExistingFile(DIRNAME, b.filename)).arrayBuffer())
    expect(patched.length).toBe(opus.length)
    const middle = delay + hq.length / 2
    expect(patched[middle]).toBeCloseTo(hq[middle - delay] / 32768, 4)
  } finally {
    GlobalSettings.useMemoryFS = previousMemoryFS
    openPatchPort = unattachedPort
    vi.unstubAllGlobals()
  }
})
