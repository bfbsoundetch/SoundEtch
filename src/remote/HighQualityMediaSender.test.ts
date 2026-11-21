import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import './FakesForRemoteTests'
import { AudioControl, AudioState } from '../audiocontext/AudioControl'
import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import { GlobalSettings } from '../global/GlobalSettings'
import { LocalMediaStreams } from '../mediastreams/LocalMediaStreams'
import type { FrameCapture } from './HighQualityAudioCapture'
import { HQ_AUDIO_CHUNK_FRAMES, HQ_FRAME_BYTES, HQ_UPLOAD_SPOOL_DIRECTORY } from './HighQualityAudioFormat'
import { type HighQualityConnection, HighQualityMediaSender, HQ_LEAVE_TIMEOUT_MS } from './HighQualityMediaSender'
import type {
  HighQualityListener,
  HighQualityMessage,
  Member,
  RecordingActivity,
  StateListener,
} from './RemoteMediaClient3'

vi.mock('../audiocontext/EnhancedAudioContext', () => ({ EnhancedAudioContext: { create: vi.fn() } }))
vi.mock('../ui/NotificationsController', () => ({
  NotificationsController: { showLongDurationMessage: () => ({ updateMessage() {}, remove() {} }) },
}))

GlobalSettings.useMemoryFS = true

const RECORDER = 'recorder'

type Sent = { peerId: string; message: HighQualityMessage }

class FakeConnection implements HighQualityConnection {
  readonly sent = new Array<Sent>()
  buffered: number | null = 0
  private readonly stateListeners = new Array<StateListener>()
  private readonly highQualityListeners = new Array<HighQualityListener>()
  private members = new Array<Member>()

  addStateListener(listener: StateListener) {
    this.stateListeners.push(listener)
    listener(this.state())
  }

  addHighQualityListener(listener: HighQualityListener) {
    this.highQualityListeners.push(listener)
  }

  sendHighQuality(peerId: string, message: HighQualityMessage) {
    this.sent.push({ peerId, message })
    return true
  }

  getSendBufferedAmount() {
    return this.buffered
  }

  setMembers(members: Member[]) {
    this.members = members
    this.stateListeners.forEach((listener) => listener(this.state()))
  }

  deliver(peerId: string, message: HighQualityMessage) {
    this.highQualityListeners.forEach((listener) => listener(peerId, message))
  }

  ofType<T extends HighQualityMessage['type']>(type: T) {
    return this.sent.map((sent) => sent.message).filter((message) => message.type == type) as Array<
      Extract<HighQualityMessage, { type: T }>
    >
  }

  private state() {
    return {
      members: this.members,
      roomId: 'room',
      isHost: false,
      hostUsername: null,
      waitingForHost: false,
      joinRequests: [],
      screenShare: null,
      error: null,
    }
  }
}

class FakeCapture implements FrameCapture {
  running = false
  startResult: Promise<boolean> = Promise.resolve(true)

  constructor(private readonly onFrame: (seq: number, pcm: ArrayBuffer) => void) {}

  start() {
    this.running = true
    return this.startResult
  }

  stop() {
    this.running = false
  }

  elapsedSamples() {
    return this.running ? 0 : null
  }

  emit(seq: number) {
    const pcm = new Int16Array(HQ_FRAME_BYTES / 2).fill(seq)
    this.onFrame(seq, pcm.buffer)
  }
}

function member(peerId: string, state: RecordingActivity['state'] = 'recording'): Member {
  return {
    peerId,
    username: peerId,
    mediaStream: new MediaStream(),
    error: null,
    recordingActivity: { state, countdownId: null } as RecordingActivity,
  }
}

/** Lets promise chains and the hash computations behind them settle; setImmediate stays real. */
async function settle(rounds = 20) {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setImmediate(resolve))
}

let connection: FakeConnection
let captures: FakeCapture[]
let locallyRecording: boolean
let sender: HighQualityMediaSender
let micTrack: MediaStreamTrack

function createSender() {
  sender = new HighQualityMediaSender(connection, {
    createCapture: (onFrame) => {
      const capture = new FakeCapture(onFrame)
      captures.push(capture)
      return capture
    },
    createVideoRecorder: () => ({ attach() {}, finish: async () => null }),
    upload: async () => null,
    isLocallyRecording: () => locallyRecording,
  })
}

async function acceptOffer(transport: 'peer' | 'cloud' = 'peer', sessionId = 'session-1') {
  connection.deliver(RECORDER, { type: 'hqOffer', sessionId, transport, video: false })
  await settle()
  expect(connection.ofType('hqAccept')).toContainEqual({ type: 'hqAccept', sessionId })
  return captures.at(-1)!
}

function framesSent() {
  return connection.ofType('hqFrame')
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  Object.assign(globalThis, { addEventListener: () => {}, removeEventListener: () => {} })
  Object.assign(navigator, { storage: { getDirectory: async () => ({}) } })
  micTrack = new MediaStreamTrack()
  LocalMediaStreams.localAVDeviceMediaStream.addTrack(micTrack)
  connection = new FakeConnection()
  captures = []
  locallyRecording = false
  createSender()
  connection.setMembers([member(RECORDER)])
})

afterEach(() => {
  sender.dispose()
  LocalMediaStreams.localAVDeviceMediaStream
    .getTracks()
    .forEach((track) => LocalMediaStreams.localAVDeviceMediaStream.removeTrack(track))
  vi.useRealTimers()
})

test('frames flow only after the offer is accepted', async () => {
  const start = Promise.withResolvers<boolean>()
  const createCapture = (onFrame: (seq: number, pcm: ArrayBuffer) => void) => {
    const capture = new FakeCapture(onFrame)
    capture.startResult = start.promise
    captures.push(capture)
    return capture
  }
  sender.dispose()
  sender = new HighQualityMediaSender(connection, {
    createCapture,
    createVideoRecorder: () => ({ attach() {}, finish: async () => null }),
    isLocallyRecording: () => false,
  })
  connection.deliver(RECORDER, { type: 'hqOffer', sessionId: 's', transport: 'peer', video: false })
  for (let seq = 0; seq < 5; seq++) captures[0].emit(seq)
  await vi.advanceTimersByTimeAsync(1000)
  expect(connection.sent).toEqual([])

  start.resolve(true)
  await settle()
  await vi.advanceTimersByTimeAsync(1000)
  expect(connection.sent[0].message).toEqual({ type: 'hqAccept', sessionId: 's' })
  expect(framesSent().map((frame) => frame.seq)).toEqual([0, 1, 2, 3, 4])
})

test('live pacing sends 15 ± 1 frames per second from a 100-frame backlog', async () => {
  const capture = await acceptOffer()
  for (let seq = 0; seq < 100; seq++) capture.emit(seq)
  let previous = 0
  for (let second = 1; second <= 5; second++) {
    await vi.advanceTimersByTimeAsync(1000)
    const count = framesSent().length
    expect(count - previous).toBeGreaterThanOrEqual(14)
    expect(count - previous).toBeLessThanOrEqual(16)
    previous = count
  }
})

test('a full send buffer blocks sending', async () => {
  connection.buffered = 40000
  const capture = await acceptOffer()
  for (let seq = 0; seq < 10; seq++) capture.emit(seq)
  await vi.advanceTimersByTimeAsync(2000)
  expect(framesSent()).toEqual([])
  connection.buffered = 0
  await vi.advanceTimersByTimeAsync(2000)
  expect(framesSent()).toHaveLength(10)
})

test('overflow beyond 18000 queued frames drops the oldest', async () => {
  connection.buffered = 40000
  const capture = await acceptOffer()
  for (let seq = 0; seq < 18002; seq++) capture.emit(seq)
  connection.setMembers([member(RECORDER, 'paused')])
  connection.buffered = 0
  await vi.advanceTimersByTimeAsync(300_000)
  expect(framesSent()[0].seq).toBe(2)
  expect(connection.ofType('hqEnd')).toEqual([
    { type: 'hqEnd', sessionId: 'session-1', frameCount: 18002, sentCount: 18000 },
  ])
})

test('a pause ends the session with hqEnd', async () => {
  const capture = await acceptOffer()
  for (let seq = 0; seq < 20; seq++) if (seq != 7) capture.emit(seq)
  connection.setMembers([member(RECORDER, 'paused')])
  expect(capture.running).toBe(false)
  await vi.advanceTimersByTimeAsync(2000)
  expect(framesSent()).toHaveLength(19)
  expect(connection.sent.at(-1)!.message).toEqual({
    type: 'hqEnd',
    sessionId: 'session-1',
    frameCount: 20,
    sentCount: 19,
  })
})

test('the recorder leaving drops the session silently', async () => {
  const capture = await acceptOffer()
  for (let seq = 0; seq < 20; seq++) capture.emit(seq)
  await vi.advanceTimersByTimeAsync(200)
  const sentBefore = connection.sent.length
  connection.setMembers([])
  expect(capture.running).toBe(false)
  await vi.advanceTimersByTimeAsync(5000)
  expect(connection.sent).toHaveLength(sentBefore)
})

test('a changed microphone ends the session', async () => {
  const capture = await acceptOffer()
  LocalMediaStreams.endAudioDeviceStream()
  expect(capture.running).toBe(false)
  await vi.advanceTimersByTimeAsync(1000)
  expect(connection.ofType('hqEnd')).toHaveLength(1)
})

test('hqCancel stops the session without an end message', async () => {
  const capture = await acceptOffer()
  capture.emit(0)
  connection.deliver(RECORDER, { type: 'hqCancel', sessionId: 'session-1' })
  expect(capture.running).toBe(false)
  await vi.advanceTimersByTimeAsync(2000)
  expect(framesSent()).toEqual([])
  expect(connection.ofType('hqEnd')).toEqual([])
})

test('a second offer while a session is active is declined as busy', async () => {
  await acceptOffer()
  connection.setMembers([member(RECORDER), member('other')])
  connection.deliver('other', { type: 'hqOffer', sessionId: 'session-2', transport: 'peer', video: false })
  await settle()
  expect(connection.sent.at(-1)).toEqual({
    peerId: 'other',
    message: { type: 'hqDecline', sessionId: 'session-2', reason: 'busy' },
  })
})

test('an offer without a microphone is declined', async () => {
  LocalMediaStreams.localAVDeviceMediaStream.removeTrack(micTrack)
  connection.deliver(RECORDER, { type: 'hqOffer', sessionId: 's', transport: 'peer', video: false })
  await settle()
  expect(connection.ofType('hqDecline')).toEqual([{ type: 'hqDecline', sessionId: 's', reason: 'noMicrophone' }])
})

test('a cloud offer while recording locally is declined', async () => {
  locallyRecording = true
  connection.deliver(RECORDER, { type: 'hqOffer', sessionId: 's', transport: 'cloud', video: false })
  await settle()
  expect(connection.ofType('hqDecline')).toEqual([{ type: 'hqDecline', sessionId: 's', reason: 'recording' }])
  expect(captures).toEqual([])
})

test('starting to record during a cloud session fails it and deletes the spool', async () => {
  const capture = await acceptOffer('cloud')
  for (let seq = 0; seq < HQ_AUDIO_CHUNK_FRAMES; seq++) capture.emit(seq)
  await settle()
  expect(await FileSystemUtils.getDirectoryFiles(HQ_UPLOAD_SPOOL_DIRECTORY)).toHaveLength(1)

  locallyRecording = true
  AudioControl.audioControlListeners.forEach((listener) => listener(AudioState.RECORDING))
  expect(capture.running).toBe(false)
  expect(connection.ofType('hqFailed')).toEqual([
    { type: 'hqFailed', sessionId: 'session-1', message: 'recording started' },
  ])
  await settle()
  expect(await FileSystemUtils.getDirectoryFiles(HQ_UPLOAD_SPOOL_DIRECTORY)).toEqual([])
})

test('prepareToLeave ends the cloud session and waits for the links it requested', async () => {
  const capture = await acceptOffer('cloud')
  for (let seq = 0; seq < 10; seq++) capture.emit(seq)
  let left = false
  const leaving = sender.prepareToLeave().then(() => (left = true))
  await settle()
  expect(capture.running).toBe(false)
  expect(connection.ofType('hqLinkRequest')).toEqual([
    { type: 'hqLinkRequest', sessionId: 'session-1', names: ['audio-00001.pcm', 'manifest.json'] },
  ])
  expect(left).toBe(false)
  connection.deliver(RECORDER, {
    type: 'hqLinks',
    sessionId: 'session-1',
    links: ['audio-00001.pcm', 'manifest.json'].map((name) => ({
      name,
      method: 'PUT' as const,
      url: `https://s3.example/${name}`,
    })),
  })
  await leaving
  expect(left).toBe(true)
})

test('prepareToLeave gives up waiting for links after the timeout', async () => {
  const capture = await acceptOffer('cloud')
  capture.emit(0)
  let left = false
  void sender.prepareToLeave().then(() => (left = true))
  await settle()
  await vi.advanceTimersByTimeAsync(HQ_LEAVE_TIMEOUT_MS - 1)
  expect(left).toBe(false)
  await vi.advanceTimersByTimeAsync(1)
  expect(left).toBe(true)
})

test('dispose drops a peer session without sending anything', async () => {
  const capture = await acceptOffer()
  for (let seq = 0; seq < 10; seq++) capture.emit(seq)
  const sentBefore = connection.sent.length
  sender.dispose()
  expect(capture.running).toBe(false)
  await vi.advanceTimersByTimeAsync(2000)
  expect(connection.sent).toHaveLength(sentBefore)
})
