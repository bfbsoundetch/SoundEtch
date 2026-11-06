import { beforeEach, expect, test, vi } from 'vitest'
import type { EnhancedAudioContext } from '../audiocontext/EnhancedAudioContext'
import type { Clip } from '../project/Clip'
import type { Project } from '../project/Project'
import type { Track } from '../project/Track'
import type { VideoSegment } from '../project/Video'
import type { VideoInput } from '../videoinputs/VideoInputs'
import { VideoRecordingSession } from './VideoRecordingSession'

const mocks = vi.hoisted(() => ({
  save: vi.fn<() => Promise<void>>(),
  delete: vi.fn(),
  notify: vi.fn(),
  attach: vi.fn(),
  finish: vi.fn<() => Promise<VideoSegment | null>>(),
  options: new Array<{ onError(error: Error): void }>(),
}))

vi.mock('../project/ProjectManager', () => ({
  ProjectManager: { saveClip: mocks.save, deleteClip: mocks.delete, deleteTrack: mocks.delete },
}))
vi.mock('../ui/NotificationsController', () => ({
  NotificationsController: { showErrorMessage: mocks.notify },
}))
vi.mock('../videoinputs/VideoInputs', () => ({
  VideoInputs: { addListener: () => () => {}, gather: () => [] },
}))
vi.mock('./VideoTrackRecorder', () => ({
  VideoTrackRecorder: class {
    constructor(options: { onError(error: Error): void }) {
      mocks.options.push(options)
    }
    attach = mocks.attach
    finish = mocks.finish
  },
}))

const segment: VideoSegment = {
  index: 0,
  trackNumber: 1,
  startSample: 0,
  length: 96000,
  mediaStartSeconds: 0,
  mimeType: 'video/mp4',
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.options.length = 0
  mocks.save.mockResolvedValue()
  mocks.finish.mockResolvedValue(segment)
})

function createSession() {
  const context = Object.assign(new EventTarget(), { state: 'running', sampleRate: 48000, getPosition: () => 0 })
  const close = () => {
    context.state = 'closed'
    context.dispatchEvent(new Event('statechange'))
  }
  const onError = vi.fn(close)
  const clip = {
    filename: 'clip',
    videoRecordingInProgress: false,
    videoSegments: [],
    videoLength: 0,
    audioPresent: true,
  } as unknown as Clip
  const track = {} as Track
  const project = { directoryName: 'project', sampleRate: 48000 } as Project
  const input = { name: 'Camera', track: {} } as VideoInput
  const { promise: finished, resolve } = Promise.withResolvers<Track[]>()
  const onFinished = vi.fn(resolve)
  const session = new VideoRecordingSession(context as unknown as EnhancedAudioContext, project, onFinished, onError)
  session.start()
  return { session, context, close, onError, clip, track, input, finished }
}

test('video quota calls the recording-wide callback without a duplicate per-source notice', async () => {
  const { session, onError, clip, track, input, finished, context } = createSession()
  await session.add(input, clip, track)
  const error = new DOMException('Storage is full', 'QuotaExceededError')
  mocks.options[0].onError(error)
  expect(onError).toHaveBeenCalledWith(error)
  expect(context.state).toBe('closed')
  expect(await finished).toEqual([track])
  expect(clip.videoRecordingInProgress).toBe(false)
  expect(mocks.notify).not.toHaveBeenCalled()
})

test('failed recovery preserves the in-progress marker and does not settle as empty', async () => {
  const { session, close, clip, track, input, finished } = createSession()
  await session.add(input, clip, track)
  mocks.finish.mockRejectedValue(new Error('Could not read the flushed prefix'))
  close()
  expect(await finished).toEqual([])
  expect(clip.videoRecordingInProgress).toBe(true)
  expect(mocks.save).toHaveBeenCalledOnce()
  expect(mocks.delete).not.toHaveBeenCalled()
})

test('quota while persisting the recovered segment preserves the recovery marker and footage', async () => {
  const { session, close, onError, clip, track, input, finished } = createSession()
  await session.add(input, clip, track)
  mocks.save.mockRejectedValue(new DOMException('Storage is full', 'QuotaExceededError'))
  close()
  expect(await finished).toEqual([])
  expect(clip.videoRecordingInProgress).toBe(true)
  expect(clip.videoSegments).toEqual([])
  expect(onError).toHaveBeenCalledOnce()
  expect(mocks.delete).not.toHaveBeenCalled()
  expect(mocks.notify).not.toHaveBeenCalled()
})

test('context close waits for an in-flight add and never attaches it or accepts later inputs', async () => {
  const { session, close, clip, track, input, finished } = createSession()
  const { promise: saving, resolve: saved } = Promise.withResolvers<void>()
  mocks.save.mockReturnValueOnce(saving)
  mocks.finish.mockResolvedValue(null)
  const adding = session.add(input, clip, track)
  close()
  await session.add(input, clip, track)
  expect(mocks.finish).not.toHaveBeenCalled()
  saved()
  await adding
  expect(await finished).toEqual([])
  expect(mocks.attach).not.toHaveBeenCalled()
  expect(mocks.finish).toHaveBeenCalledOnce()
  expect(clip.videoRecordingInProgress).toBe(false)
})

test('quota while saving the initial recovery marker stops the recording without starting a video writer', async () => {
  const { session, context, onError, clip, track, input, finished } = createSession()
  mocks.save.mockRejectedValueOnce(new DOMException('Storage is full', 'QuotaExceededError'))
  await expect(session.add(input, clip, track)).rejects.toMatchObject({ name: 'QuotaExceededError' })
  expect(await finished).toEqual([])
  expect(context.state).toBe('closed')
  expect(onError).toHaveBeenCalledOnce()
  expect(mocks.attach).not.toHaveBeenCalled()
  expect(mocks.finish).not.toHaveBeenCalled()
  expect(mocks.notify).not.toHaveBeenCalled()
})
