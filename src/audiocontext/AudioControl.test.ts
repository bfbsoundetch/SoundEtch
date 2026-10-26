import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { AudioControl, AudioState, type ActiveAudioState } from './AudioControl'
import { EnhancedAudioContext } from './EnhancedAudioContext'

vi.mock('./EnhancedAudioContext', () => ({
  EnhancedAudioContext: { create: vi.fn() },
}))

interface Deferred {
  readonly promise: Promise<void>
  resolve(): void
}

function deferred(): Deferred {
  let resolve!: () => void
  const promise = new Promise<void>((done) => (resolve = done))
  return { promise, resolve }
}

class Context extends EventTarget {
  state: AudioContextState = 'suspended'
  readonly resumeStarted = deferred()
  resumeGate: Deferred | null = null

  constructor(readonly mode: ActiveAudioState) {
    super()
  }

  async suspend() {
    this.state = 'suspended'
  }

  async resume() {
    this.resumeStarted.resolve()
    await this.resumeGate?.promise
    if (this.state == 'closed') throw new DOMException('Closed before resume completed', 'InvalidStateError')
    this.state = 'running'
  }

  async close() {
    this.state = 'closed'
  }
}

beforeEach(() => {
  AudioControl.audioContext = null
  vi.mocked(EnhancedAudioContext.create).mockImplementation(async (mode) => {
    return new Context(mode) as unknown as EnhancedAudioContext
  })
})

afterEach(async () => {
  await AudioControl.closeAndRemoveAudioContext()
  vi.clearAllMocks()
})

test('finishes monitoring startup before replacing its context for recording', async () => {
  const monitoring = new Context(AudioState.MONITORING)
  const gate = deferred()
  monitoring.resumeGate = gate
  AudioControl.audioContext = monitoring as unknown as EnhancedAudioContext

  const starting = AudioControl.startMonitoring()
  await monitoring.resumeStarted.promise
  const recording = AudioControl.createNewAudioContext(AudioState.RECORDING)
  let replaced = false
  void recording.then(() => (replaced = true))

  try {
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(monitoring.state).toBe('suspended')
    expect(replaced).toBe(false)
  } finally {
    gate.resolve()
    await starting
    await recording
  }

  expect(monitoring.state).toBe('closed')
  expect(AudioControl.getState()).toBe(AudioState.RECORDING_PAUSED)
})

test('does not replace or resume a paused recording when monitoring is requested', async () => {
  const recording = await AudioControl.createNewAudioContext(AudioState.RECORDING)

  expect(await AudioControl.startMonitoring()).toBeNull()
  expect(AudioControl.audioContext).toBe(recording)
  expect(AudioControl.getState()).toBe(AudioState.RECORDING_PAUSED)
})
