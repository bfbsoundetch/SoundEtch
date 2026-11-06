import { RingBuffer } from 'ringbuf.js'
import { AudioFileWritingJob } from './AudioFileWritingJob'
import { Summary } from '../project/Summary'
import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import { MemoryBackedFileSystemSyncAccessHandle } from '../filesystem/MemoryBackedFileSystemSyncAccessHandle'
import { ControllableWorkerJobFactory, type ControllableWorkerJob } from '../audiocontext/ControllableWorkerJob'

vi.mock('../audiocontext/ControllableWorkerJob', () => ({
  ControllableWorkerJobFactory: { getControllableWorkerJob: vi.fn() },
}))

type RecordingInput = Parameters<typeof AudioFileWritingJob.create>[0][number]
type WorkerMessage = { readonly type: string; readonly error?: { readonly name: string; readonly message: string } }
const scope: {
  controllable: ControllableWorkerJob | null
  onmessage?: (event: { data: { type: string; jobType: string; argument: readonly RecordingInput[] } }) => Promise<void>
} = { controllable: null }
let messages: WorkerMessage[]

beforeAll(async () => {
  vi.stubGlobal('self', scope)
  // The worker installs self.onmessage at module evaluation, so its test scope must exist first.
  await import('../audiocontext/AudioContextControlledWorkerScript.js')
})

beforeEach(() => {
  messages = []
  scope.controllable = null
  vi.stubGlobal('postMessage', vi.fn((message: WorkerMessage) => messages.push(message)))
  vi.mocked(ControllableWorkerJobFactory.getControllableWorkerJob).mockImplementation((_jobType, argument) =>
    AudioFileWritingJob.create(argument),
  )
})

afterEach(() => {
  vi.restoreAllMocks()
})

afterAll(() => {
  vi.unstubAllGlobals()
})

test.each([0, 1])('setup failure on input %i closes every acquired handle and always emits error then finished', async (failedInput) => {
  const inputs = [recordingInput('first'), recordingInput('second')]
  const handles = createHandles(inputs)
  const quota = new DOMException('Cannot acquire summary storage', 'QuotaExceededError')
  const failingSummary = handles.get(`${inputs[failedInput].clip.filename}_summary`)!
  vi.spyOn(failingSummary, 'createSyncAccessHandle').mockRejectedValue(quota)
  const firstAudio = handles.get(inputs[0].clip.filename)!
  vi.mocked(firstAudio.close).mockImplementation(() => {
    MemoryBackedFileSystemSyncAccessHandle.prototype.close.call(firstAudio)
    throw new Error('A secondary cleanup failure')
  })
  useHandles(handles)

  await startWorker(inputs)

  expect(messages).toEqual([
    { type: 'error', error: { name: 'QuotaExceededError', message: quota.message } },
    { type: 'finished' },
  ])
  expect(Object.getPrototypeOf(messages[0].error)).toBe(Object.prototype)
  for (let i = 0; i <= failedInput; ++i) {
    expect(handles.get(inputs[i].clip.filename)!.close).toHaveBeenCalledOnce()
    expect(handles.get(`${inputs[i].clip.filename}_summary`)!.close).toHaveBeenCalledTimes(i < failedInput ? 1 : 0)
  }
  for (const handle of handles.values()) expect(handle.write).not.toHaveBeenCalled()
  expect(scope.controllable).toBeNull()
})

test('one input quota failure immediately reports once and stops every other writer before consuming queued audio', async () => {
  const inputs = [recordingInput('first'), recordingInput('second')]
  const handles = createHandles(inputs)
  const quota = new DOMException('Recording storage is full', 'QuotaExceededError')
  const firstAudio = handles.get(inputs[0].clip.filename)!
  const secondAudio = handles.get(inputs[1].clip.filename)!
  vi.mocked(firstAudio.write).mockImplementation(() => {
    throw quota
  })
  useHandles(handles)
  const errorBeforeCleanup: boolean[] = []
  const finishedAfterCleanup: boolean[] = []
  vi.mocked(postMessage).mockImplementation((message: WorkerMessage) => {
    messages.push(message)
    if (message.type === 'error') {
      errorBeforeCleanup.push([...handles.values()].every((handle) => vi.mocked(handle.close).mock.calls.length === 0))
    }
    if (message.type === 'finished') {
      finishedAfterCleanup.push([...handles.values()].every((handle) => vi.mocked(handle.close).mock.calls.length === 1))
    }
  })

  await startWorker(inputs)

  expect(messages).toEqual([
    { type: 'ready' },
    { type: 'error', error: { name: 'QuotaExceededError', message: quota.message } },
    { type: 'finished' },
  ])
  expect(errorBeforeCleanup).toEqual([true])
  expect(finishedAfterCleanup).toEqual([true])
  expect(secondAudio.write).not.toHaveBeenCalled()
  expect(new RingBuffer(inputs[1].ringBufferArray, Float32Array).availableRead()).toBe(2)
  for (const handle of handles.values()) expect(handle.close).toHaveBeenCalledOnce()
})

test('job start rejects its original writer failure after all cleanup instead of swallowing allSettled results', async () => {
  const inputs = [recordingInput('first'), recordingInput('second')]
  const handles = createHandles(inputs)
  const quota = new DOMException('Storage is full', 'QuotaExceededError')
  vi.mocked(handles.get(inputs[0].clip.filename)!.write).mockImplementation(() => {
    throw quota
  })
  useHandles(handles)
  const job = await AudioFileWritingJob.create(inputs)
  const onError = vi.fn()

  await expect(job.start(onError)).rejects.toBe(quota)

  expect(onError).toHaveBeenCalledExactlyOnceWith(quota)
  for (const handle of handles.values()) expect(handle.close).toHaveBeenCalledOnce()
})

function recordingInput(filename: string): RecordingInput {
  const ringBufferArray = RingBuffer.getStorageForCapacity(1024, Float32Array)
  new RingBuffer(ringBufferArray, Float32Array).push(new Float32Array([0.25, -0.5]))
  return {
    dirname: 'quota-tests',
    channelCount: 1,
    clip: { filename, summary: new Summary(1) },
    ringBufferArray,
    overrunSampleCount: new SharedArrayBuffer(4),
  }
}

function createHandles(inputs: readonly RecordingInput[]) {
  const handles = new Map<string, MemoryBackedFileSystemSyncAccessHandle>()
  for (const input of inputs) {
    for (const filename of [input.clip.filename, `${input.clip.filename}_summary`]) {
      const handle = new MemoryBackedFileSystemSyncAccessHandle(filename)
      vi.spyOn(handle, 'close')
      vi.spyOn(handle, 'write')
      handles.set(filename, handle)
    }
  }
  return handles
}

function useHandles(handles: ReadonlyMap<string, MemoryBackedFileSystemSyncAccessHandle>) {
  vi.spyOn(FileSystemUtils, 'getFileHandle').mockImplementation(async (_dirname, filename) => {
    const handle = handles.get(filename)
    if (!handle) throw new Error(`Unexpected file: ${filename}`)
    return handle
  })
}

async function startWorker(inputs: readonly RecordingInput[]) {
  await scope.onmessage!({ data: { type: 'start', jobType: 'recorder', argument: inputs } })
}

test('a failing input wakes and closes another writer already waiting while paused', async () => {
  const inputs = [recordingInput('paused'), recordingInput('failing')]
  new RingBuffer(inputs[0].ringBufferArray, Float32Array).pop(new Float32Array(2))
  const handles = createHandles(inputs)
  const quota = new DOMException('Storage is full', 'QuotaExceededError')
  vi.mocked(handles.get(inputs[1].clip.filename)!.write).mockImplementation(() => {
    throw quota
  })
  useHandles(handles)
  const job = await AudioFileWritingJob.create(inputs)
  job.pause()
  const onError = vi.fn()

  await expect(job.start(onError)).rejects.toBe(quota)

  expect(onError).toHaveBeenCalledExactlyOnceWith(quota)
  expect(handles.get(inputs[0].clip.filename)!.write).not.toHaveBeenCalled()
  for (const handle of handles.values()) expect(handle.close).toHaveBeenCalledOnce()
})
