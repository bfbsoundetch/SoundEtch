import type { Clip } from '../project/Clip'
import type { Project } from '../project/Project'
import {
  WASM_THREADS_UNAVAILABLE_ERROR,
  WEBGPU_INITIALIZATION_TIMEOUT_ERROR,
  type TranscribeCommand,
  type TranscriptionWorkerMessage,
} from './TranscriptionProtocol'

class FakeWorker extends EventTarget {
  static instances: FakeWorker[] = []
  readonly commands: TranscribeCommand[] = []
  terminated = false

  constructor() {
    super()
    FakeWorker.instances.push(this)
  }

  postMessage(command: TranscribeCommand): void {
    this.commands.push(command)
  }

  terminate(): void {
    this.terminated = true
  }

  reply(message: TranscriptionWorkerMessage): void {
    this.dispatchEvent(new MessageEvent('message', { data: message }))
  }

  fail(requestId: number, name: string): void {
    this.reply({ type: 'error', requestId, error: { name, message: `${name} message` } })
  }
}

const project = { id: 1, sampleRate: 48_000 } as Project
const clip = { id: 7, getChannelCount: () => 2 } as unknown as Clip
const intervals = [{ clip, startSample: 0, endSample: 48_000 }]

async function loadTranscriber() {
  vi.resetModules()
  FakeWorker.instances = []
  vi.stubGlobal('Worker', FakeWorker)
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  // Transcriber keeps page-session state in statics; each test needs a fresh module instance.
  return (await import('./Transcriber')).Transcriber
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

test('a pthread load failure restarts once in a fresh single-threaded worker and stays disabled', async () => {
  const Transcriber = await loadTranscriber()
  const first = Transcriber.transcribe(project, intervals)
  const [stalled] = FakeWorker.instances
  expect(stalled.commands[0]).toMatchObject({ allowWebGpu: true, allowWasmThreads: true })

  stalled.fail(1, WASM_THREADS_UNAVAILABLE_ERROR)
  const [, restarted] = FakeWorker.instances
  expect(stalled.terminated).toBe(true)
  expect(restarted.commands).toEqual([{ ...stalled.commands[0], allowWasmThreads: false }])

  restarted.reply({
    type: 'complete',
    requestId: 1,
    results: [{ clipId: 7, channelCount: 2, startSample: 0, endSample: 48_000, ranges: [] }],
  })
  await expect(first).resolves.toEqual([{ clip, startSample: 0, endSample: 48_000, ranges: [] }])

  void Transcriber.transcribe(project, intervals)
  expect(restarted.commands[1]).toMatchObject({ requestId: 2, allowWebGpu: true, allowWasmThreads: false })
})

test('a repeated failure after its restart rejects instead of restarting again', async () => {
  const Transcriber = await loadTranscriber()
  const request = Transcriber.transcribe(project, intervals)
  FakeWorker.instances[0].fail(1, WASM_THREADS_UNAVAILABLE_ERROR)
  FakeWorker.instances[1].fail(1, WASM_THREADS_UNAVAILABLE_ERROR)

  await expect(request).rejects.toMatchObject({ name: WASM_THREADS_UNAVAILABLE_ERROR })
  expect(FakeWorker.instances).toHaveLength(2)
})

test('WebGPU and thread restarts compose, each disabling only its own capability', async () => {
  const Transcriber = await loadTranscriber()
  void Transcriber.transcribe(project, intervals)
  FakeWorker.instances[0].fail(1, WEBGPU_INITIALIZATION_TIMEOUT_ERROR)
  expect(FakeWorker.instances[1].commands[0]).toMatchObject({ allowWebGpu: false, allowWasmThreads: true })

  FakeWorker.instances[1].fail(1, WASM_THREADS_UNAVAILABLE_ERROR)
  expect(FakeWorker.instances[2].commands[0]).toMatchObject({ allowWebGpu: false, allowWasmThreads: false })
})
