import type { TranscribedRange } from '../project/Transcription'

export type TranscriptionBackend = 'WebGPU' | 'WASM'

/** Error name the worker reports when WebGPU setup exceeds its deadline. */
export const WEBGPU_INITIALIZATION_TIMEOUT_ERROR = 'WebGpuInitializationTimeoutError'

/** Error name the worker reports when an ONNX Runtime WebAssembly thread worker fails to load. */
export const WASM_THREADS_UNAVAILABLE_ERROR = 'WasmThreadsUnavailableError'

export interface WorkerClipInterval {
  readonly clipId: number
  readonly channelCount: number
  readonly startSample: number
  readonly endSample: number
}

export interface TranscribeCommand {
  readonly type: 'transcribe'
  readonly requestId: number
  readonly projectId: number
  readonly projectSampleRate: number
  readonly intervals: WorkerClipInterval[]
  readonly allowWebGpu: boolean
  readonly allowWasmThreads: boolean
}

export type TranscriptionWorkerCommand = TranscribeCommand

export interface TranscriptionProgress {
  readonly stage: 'download' | 'loading' | 'transcribing'
  readonly progress: number
  readonly backend?: TranscriptionBackend
}

export interface TranscriptionProgressMessage extends TranscriptionProgress {
  readonly type: 'progress'
  readonly requestId: number
}

export interface WorkerIntervalResult extends WorkerClipInterval {
  readonly ranges: TranscribedRange[]
}

export interface TranscriptionCompleteMessage {
  readonly type: 'complete'
  readonly requestId: number
  readonly results: WorkerIntervalResult[]
}

export interface SerializedTranscriptionError {
  readonly name: string
  readonly message: string
  readonly stack?: string
}

export interface TranscriptionErrorMessage {
  readonly type: 'error'
  readonly requestId: number
  readonly error: SerializedTranscriptionError
}

export type TranscriptionWorkerMessage =
  TranscriptionProgressMessage | TranscriptionCompleteMessage | TranscriptionErrorMessage
