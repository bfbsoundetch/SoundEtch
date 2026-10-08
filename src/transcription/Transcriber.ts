import type { Clip } from '../project/Clip'
import type { Project } from '../project/Project'
import type { TranscribedRange } from '../project/Transcription'
import {
  WASM_THREADS_UNAVAILABLE_ERROR,
  WEBGPU_INITIALIZATION_TIMEOUT_ERROR,
  type TranscribeCommand,
  type TranscriptionProgress,
  type TranscriptionWorkerMessage,
} from './TranscriptionProtocol'
import type { SelectedClipInterval } from './TranscriptionSelection'

export interface TranscriptionIntervalResult extends SelectedClipInterval {
  readonly ranges: TranscribedRange[]
}

interface ActiveTranscription {
  readonly requestId: number
  readonly command: TranscribeCommand
  readonly clipsById: ReadonlyMap<number, Clip>
  readonly resolve: (results: TranscriptionIntervalResult[]) => void
  readonly reject: (reason?: unknown) => void
  readonly onProgress: (progress: TranscriptionProgress) => void
}

export class Transcriber {
  private static worker: Worker | null = null
  private static active: ActiveTranscription | null = null
  private static nextRequestId = 1
  // Each flag is cleared for the rest of the page session when its ORT setup
  // stalls; the stalled ORT instance is discarded with its worker.
  private static webGpuAllowed = true
  private static wasmThreadsAllowed = true

  static transcribe(
    project: Project,
    intervals: readonly SelectedClipInterval[],
    onProgress: (progress: TranscriptionProgress) => void = () => {},
  ): Promise<TranscriptionIntervalResult[]> {
    if (this.active) {
      return Promise.reject(new Error('A transcription is already in progress'))
    }
    if (project.id === undefined) {
      return Promise.reject(new Error('The active project must be saved before it can be transcribed'))
    }

    const clipsById = new Map<number, Clip>()
    const workerIntervals = intervals.map(({ clip, startSample, endSample }) => {
      if (clip.id === undefined) {
        throw new Error('Every selected clip must be saved before it can be transcribed')
      }
      clipsById.set(clip.id, clip)
      return {
        clipId: clip.id,
        channelCount: clip.getChannelCount(),
        startSample,
        endSample,
      }
    })

    const requestId = this.nextRequestId++
    const command: TranscribeCommand = {
      type: 'transcribe',
      requestId,
      projectId: project.id,
      projectSampleRate: project.sampleRate,
      intervals: workerIntervals,
      allowWebGpu: this.webGpuAllowed,
      allowWasmThreads: this.wasmThreadsAllowed,
    }
    const { promise, resolve, reject } = Promise.withResolvers<TranscriptionIntervalResult[]>()
    this.active = { requestId, command, clipsById, resolve, reject, onProgress }
    console.info(`[Granite] Posting transcription request ${requestId}`, {
      allowWebGpu: command.allowWebGpu,
      allowWasmThreads: command.allowWasmThreads,
    })
    this.getWorker().postMessage(command)
    return promise
  }

  static cancel(): void {
    const active = this.active
    this.active = null
    console.info('[Granite] Transcription cancelled; terminating the worker')
    this.destroyWorker()
    active?.reject(new DOMException('Transcription cancelled', 'AbortError'))
  }

  private static getWorker(): Worker {
    if (this.worker) {
      return this.worker
    }

    const worker = new Worker(new URL('./TranscriptionWorker.ts', import.meta.url), { type: 'module' })
    worker.addEventListener('message', (event: MessageEvent<TranscriptionWorkerMessage>) =>
      this.handleMessage(event.data),
    )
    worker.addEventListener('error', (event) => {
      event.preventDefault()
      this.rejectActive(event.error ?? new Error(event.message || 'The transcription worker failed'))
      this.destroyWorker()
    })
    worker.addEventListener('messageerror', () => {
      this.rejectActive(new Error('The transcription worker returned an unreadable response'))
      this.destroyWorker()
    })
    console.info('[Granite] Started a transcription worker')
    this.worker = worker
    return worker
  }

  private static handleMessage(message: TranscriptionWorkerMessage): void {
    const active = this.active
    if (!active || message.requestId !== active.requestId) {
      return
    }

    if (message.type === 'progress') {
      active.onProgress({
        stage: message.stage,
        progress: Math.min(1, Math.max(0, message.progress)),
        ...(message.backend ? { backend: message.backend } : {}),
      })
      return
    }

    if (message.type === 'error') {
      if (message.error.name === WEBGPU_INITIALIZATION_TIMEOUT_ERROR && active.command.allowWebGpu) {
        this.webGpuAllowed = false
        this.restart(active, 'Granite WebGPU initialization timed out; restarting transcription on WASM.')
        return
      }
      if (message.error.name === WASM_THREADS_UNAVAILABLE_ERROR && active.command.allowWasmThreads) {
        this.wasmThreadsAllowed = false
        this.restart(active, `${message.error.message}; restarting transcription single-threaded.`)
        return
      }
      this.active = null
      const error = new Error(message.error.message)
      error.name = message.error.name
      if (message.error.stack) {
        error.stack = message.error.stack
      }
      active.reject(error)
      return
    }

    this.active = null

    try {
      const results = message.results.map((result) => {
        const clip = active.clipsById.get(result.clipId)
        if (!clip) {
          throw new Error(`The transcription worker returned unknown clip ${result.clipId}`)
        }
        return {
          clip,
          startSample: result.startSample,
          endSample: result.endSample,
          ranges: result.ranges,
        }
      })
      active.resolve(results)
    } catch (error) {
      active.reject(error)
    }
  }

  private static rejectActive(error: unknown): void {
    const active = this.active
    this.active = null
    active?.reject(error)
  }

  private static restart(active: ActiveTranscription, reason: string): void {
    // A stalled ORT attempt can still resume inside the old worker's shared
    // WASM instance, so only a fresh worker can safely retry.
    console.warn(`[Granite] ${reason}`)
    this.destroyWorker()
    const command: TranscribeCommand = {
      ...active.command,
      allowWebGpu: this.webGpuAllowed,
      allowWasmThreads: this.wasmThreadsAllowed,
    }
    this.active = { ...active, command }
    this.getWorker().postMessage(command)
  }

  private static destroyWorker(): void {
    this.worker?.terminate()
    this.worker = null
  }
}
