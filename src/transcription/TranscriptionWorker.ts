/// <reference lib="webworker" />

// ORT 1.26's root build uses the JSEP WebGPU backend that matches the packaged
// .jsep runtime below; its /webgpu build expects the incompatible asyncify runtime.
import * as ort from 'onnxruntime-web'
import ortWasmModuleUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs?url'
import ortWasmBinaryUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url'
import SoxrResampler from 'wasm-audio-resampler/app/soxr_resampler.js'
import { SoxrDatatype, SoxrQuality } from 'wasm-audio-resampler/app/utils.js'
import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import {
  GRANITE_MODEL_CACHE_NAME as MODEL_CACHE_NAME,
  GRANITE_MODEL_DATA_FILE as MODEL_DATA_FILE,
  GRANITE_MODEL_REVISION as MODEL_REVISION,
  GRANITE_TIMING_GRAPH_FILE as TIMING_GRAPH_FILE,
  SILERO_VAD_CACHE_NAME as VAD_CACHE_NAME,
  SILERO_VAD_FILE as VAD_FILE,
  SILERO_VAD_REVISION,
  TRANSCRIPTION_ASSET_BYTES as ASSET_MANIFEST,
} from '../ModelCache'
import type { FileSystemSyncAccessHandle } from '../filesystem/FileSystemSyncAccessHandle'
import type { TranscribedRange } from '../project/Transcription'
import type {
  SerializedTranscriptionError,
  TranscribeCommand,
  WorkerClipInterval,
  TranscriptionBackend,
  TranscriptionWorkerCommand,
  TranscriptionWorkerMessage,
} from './TranscriptionProtocol'
import { WASM_THREADS_UNAVAILABLE_ERROR, WEBGPU_INITIALIZATION_TIMEOUT_ERROR } from './TranscriptionProtocol'
import {
  createFloat32AssetView,
  graniteRealOutputFrames,
  GRANITE_SAMPLE_RATE,
  GRANITE_VAD_SEGMENTATION_SETTINGS,
  GraniteCtcDecoder,
  GraniteCtcFrontend,
  parseGraniteFrontendConfig,
  parseGraniteVocabulary,
  segmentSpeechFromVadProbabilities,
  SILERO_VAD_FRAME_SAMPLES,
  SILERO_VAD_SAMPLE_RATE,
} from './GraniteCtc'
import type { SelectedSourceSampleRange } from './GraniteCtc'
import {
  buildSpeechSupportMask,
  computeFrameEnergies,
  ctcTokenPosteriors,
  refineGraniteWords,
  timedWordsToTranscribedRanges,
  timeGraniteWords,
} from './GraniteTiming'
import {
  graniteLog,
  startGraniteRequestLog,
  traceCacheWrite,
  traceStage,
  traceWebAssemblyInstantiation,
} from './GraniteDiagnostics'
import { SileroVad } from './SileroVad'

const MODEL_BASE_URL = `https://huggingface.co/spaces/ibm-granite/granite-speech-streaming-webgpu/resolve/${MODEL_REVISION}/onnx-ctc/`
const AUDIO_READ_CHUNK_FRAMES = 65_536
const APP_BASE_PATH = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`
const SOXR_WASM_URL = new URL('soxr_wasm.wasm', new URL(APP_BASE_PATH, globalThis.location.origin)).href

type AssetName = keyof typeof ASSET_MANIFEST
type LoadedAssets = Record<AssetName, Uint8Array<ArrayBuffer>>
interface PinnedAssetSource {
  readonly url: string
  readonly cacheName: string
}

const ASSET_NAMES = Object.keys(ASSET_MANIFEST) as AssetName[]
const ASSET_SOURCES: Record<AssetName, PinnedAssetSource> = {
  [TIMING_GRAPH_FILE]: {
    url: APP_BASE_PATH + 'granite/' + TIMING_GRAPH_FILE,
    cacheName: MODEL_CACHE_NAME,
  },
  [MODEL_DATA_FILE]: { url: MODEL_BASE_URL + MODEL_DATA_FILE, cacheName: MODEL_CACHE_NAME },
  'frontend_config.json': { url: `${MODEL_BASE_URL}frontend_config.json`, cacheName: MODEL_CACHE_NAME },
  'mel_filters.bin': { url: `${MODEL_BASE_URL}mel_filters.bin`, cacheName: MODEL_CACHE_NAME },
  'stft_window.bin': { url: `${MODEL_BASE_URL}stft_window.bin`, cacheName: MODEL_CACHE_NAME },
  'vocab.json': { url: `${MODEL_BASE_URL}vocab.json`, cacheName: MODEL_CACHE_NAME },
  [VAD_FILE]: {
    url: `https://huggingface.co/onnx-community/silero-vad/resolve/${SILERO_VAD_REVISION}/onnx/model_quantized.onnx`,
    cacheName: VAD_CACHE_NAME,
  },
}
const MODEL_DOWNLOAD_BYTES = Object.values(ASSET_MANIFEST).reduce((total, bytes) => total + bytes, 0)
const WEBGPU_INITIALIZATION_TIMEOUT_MS = 30_000

interface AssetProgress {
  readonly name: AssetName
  readonly loaded: number
}

interface GraniteRuntimeState {
  readonly session: ort.InferenceSession
  readonly backend: TranscriptionBackend
  readonly frontend: GraniteCtcFrontend
  readonly decoder: GraniteCtcDecoder
  readonly vad: SileroVad
}

class Float32Accumulator {
  private buffer: Float32Array
  private sampleCount = 0

  constructor(initialCapacity: number) {
    this.buffer = new Float32Array(Math.max(1, initialCapacity))
  }

  append(bytes: Uint8Array): void {
    if (bytes.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
      throw new Error('SOXR returned an incomplete Float32 sample')
    }
    const samples =
      bytes.byteOffset % Float32Array.BYTES_PER_ELEMENT === 0
        ? new Float32Array(
            bytes.buffer as ArrayBuffer,
            bytes.byteOffset,
            bytes.byteLength / Float32Array.BYTES_PER_ELEMENT,
          )
        : new Float32Array(bytes.slice().buffer)
    const required = this.sampleCount + samples.length
    if (required > this.buffer.length) {
      const expanded = new Float32Array(Math.max(required, this.buffer.length * 2))
      expanded.set(this.buffer.subarray(0, this.sampleCount))
      this.buffer = expanded
    }
    this.buffer.set(samples, this.sampleCount)
    this.sampleCount = required
  }

  finish(): Float32Array {
    return this.buffer.subarray(0, this.sampleCount)
  }
}

let soxrWasmPromise: Promise<ArrayBuffer> | null = null

class AssetLengthError extends Error {}
class WebGpuInitializationTimeoutError extends Error {
  constructor() {
    super(`Granite WebGPU initialization exceeded ${WEBGPU_INITIALIZATION_TIMEOUT_MS / 1_000} seconds`)
    this.name = WEBGPU_INITIALIZATION_TIMEOUT_ERROR
  }
}
class WasmThreadsUnavailableError extends Error {
  constructor(workerLabel: string) {
    super(`ONNX Runtime WebAssembly thread worker failed to load (${workerLabel})`)
    this.name = WASM_THREADS_UNAVAILABLE_ERROR
  }
}

const worker = self as DedicatedWorkerGlobalScope
let activeRequestId: number | null = null
let runtimePromise: Promise<GraniteRuntimeState> | null = null
traceWebAssemblyInstantiation()
const nestedWorkerLoadFailure = monitorNestedWorkers()

/**
 * Emscripten creates ONNX Runtime's pthread pool before it attaches worker
 * error handlers, so a pool worker that fails to load is ignored and ORT
 * initialization waits forever for its "loaded" message. The returned promise
 * rejects when any nested worker fails before its first message.
 */
function monitorNestedWorkers(): Promise<never> {
  const { promise, reject } = Promise.withResolvers<never>()
  // Raced only while ORT initializes; later rejections need no observer.
  promise.catch(() => undefined)
  const NativeWorker = globalThis.Worker
  if (!NativeWorker) {
    return promise
  }
  let createdCount = 0
  globalThis.Worker = class MonitoredWorker extends NativeWorker {
    constructor(scriptURL: string | URL, options?: WorkerOptions) {
      super(scriptURL, options)
      const label = `Nested worker ${++createdCount}${options?.name ? ` (${options.name})` : ''}`
      let loaded = false
      graniteLog(`${label}: created`, String(scriptURL))
      this.addEventListener(
        'message',
        () => {
          loaded = true
          graniteLog(`${label}: first message received`)
        },
        { once: true },
      )
      this.addEventListener('error', (event) => {
        graniteLog(`${label}: error`, event.message || event.type)
        if (!loaded) {
          reject(new WasmThreadsUnavailableError(label))
        }
      })
      this.addEventListener('messageerror', () => graniteLog(`${label}: unreadable message`))
    }
  }
  return promise
}

worker.addEventListener('message', (event: MessageEvent<TranscriptionWorkerCommand>) => {
  const command = event.data
  if (activeRequestId !== null) {
    const message: TranscriptionWorkerMessage = {
      type: 'error',
      requestId: command.requestId,
      error: serializeError(new Error('A transcription is already in progress')),
    }
    worker.postMessage(message)
    return
  }

  activeRequestId = command.requestId
  startGraniteRequestLog()
  graniteLog(`Request ${command.requestId} received`, {
    intervals: command.intervals.length,
    allowWebGpu: command.allowWebGpu,
    runtimeLoaded: runtimePromise !== null,
  })
  void processTranscription(command)
    .then(() => graniteLog(`Request ${command.requestId} finished`))
    .catch((error: unknown) => {
      graniteLog(`Request ${command.requestId} failed`, error)
      const message: TranscriptionWorkerMessage = {
        type: 'error',
        requestId: command.requestId,
        error: serializeError(error),
      }
      worker.postMessage(message)
    })
    .finally(() => {
      if (activeRequestId === command.requestId) {
        activeRequestId = null
      }
    })
})

async function processTranscription(command: TranscribeCommand): Promise<void> {
  const runtime = await loadRuntime(command)
  const totalSourceSamples = command.intervals.reduce(
    (total, interval) => total + interval.endSample - interval.startSample,
    0,
  )
  let completedSourceSamples = 0
  const results = new Array<Extract<TranscriptionWorkerMessage, { type: 'complete' }>['results'][number]>()
  postProgress(command.requestId, {
    stage: 'transcribing',
    progress: 0,
    backend: runtime.backend,
  })

  for (const [intervalIndex, interval] of command.intervals.entries()) {
    assertRequestActive(command.requestId)
    const intervalLabel = `Interval ${intervalIndex + 1}/${command.intervals.length}`
    const audio = await traceStage(`${intervalLabel} audio read`, () => readSelectedAudio16k(command, interval))
    const vadProbabilities = await traceStage(`${intervalLabel} Silero VAD`, () =>
      runtime.vad.computeProbabilities(audio, () => assertRequestActive(command.requestId)),
    )
    const segments = segmentSpeechFromVadProbabilities(vadProbabilities, audio.length)
    graniteLog(`${intervalLabel}: ${(audio.length / GRANITE_SAMPLE_RATE).toFixed(1)} s, ${segments.length} segments`)
    const energies = computeFrameEnergies(audio, SILERO_VAD_FRAME_SAMPLES)
    const speechMask = buildSpeechSupportMask(
      vadProbabilities,
      segments,
      energies,
      GRANITE_VAD_SEGMENTATION_SETTINGS.negativeThreshold,
    )
    const ranges = new Array<TranscribedRange>()
    const intervalSourceSamples = interval.endSample - interval.startSample
    for (const [segmentIndex, segment] of segments.entries()) {
      assertRequestActive(command.requestId)
      ranges.push(
        ...(await traceStage(
          `${intervalLabel} segment ${segmentIndex + 1}/${segments.length} ` +
            `(${(segment.startSample / GRANITE_SAMPLE_RATE).toFixed(1)}–` +
            `${(segment.endSample / GRANITE_SAMPLE_RATE).toFixed(1)} s)`,
          () =>
            transcribeGraniteSegment(
              runtime,
              audio.subarray(segment.startSample, segment.endSample),
              segment.startSample,
              command.projectSampleRate,
              interval,
              speechMask,
              energies,
            ),
        )),
      )
      const completedWithinInterval =
        audio.length === 0
          ? intervalSourceSamples
          : Math.round((segment.endSample / audio.length) * intervalSourceSamples)
      postProgress(command.requestId, {
        stage: 'transcribing',
        progress: (completedSourceSamples + completedWithinInterval) / Math.max(1, totalSourceSamples),
        backend: runtime.backend,
      })
    }
    ranges.sort((left, right) => left.startSample - right.startSample || left.endSample - right.endSample)
    for (let index = 1; index < ranges.length; ++index) {
      if (ranges[index].startSample < ranges[index - 1].endSample) {
        throw new Error('Granite produced overlapping word ranges')
      }
    }
    results.push({ ...interval, ranges })
    completedSourceSamples += intervalSourceSamples
    postProgress(command.requestId, {
      stage: 'transcribing',
      progress: completedSourceSamples / Math.max(1, totalSourceSamples),
      backend: runtime.backend,
    })
  }

  assertRequestActive(command.requestId)
  const message: TranscriptionWorkerMessage = {
    type: 'complete',
    requestId: command.requestId,
    results,
  }
  worker.postMessage(message)
}

async function readSelectedAudio16k(command: TranscribeCommand, interval: WorkerClipInterval): Promise<Float32Array> {
  if (
    interval.channelCount <= 0 ||
    interval.startSample < 0 ||
    interval.startSample >= interval.endSample ||
    !Number.isInteger(interval.startSample) ||
    !Number.isInteger(interval.endSample)
  ) {
    throw new Error(`Invalid source interval for clip ${interval.clipId}`)
  }

  const sourceFrameCount = interval.endSample - interval.startSample
  const expectedOutputSamples = Math.ceil((sourceFrameCount * 16_000) / command.projectSampleRate) + 4_096
  const output = new Float32Accumulator(expectedOutputSamples)
  const resampler = new SoxrResampler(
    1,
    command.projectSampleRate,
    16_000,
    SoxrDatatype.SOXR_FLOAT32,
    SoxrDatatype.SOXR_FLOAT32,
    SoxrQuality.SOXR_MQ,
  )
  await resampler.init(undefined, { wasmBinary: await getSoxrWasmBinary() })

  const fileHandle = await FileSystemUtils.getFileHandle(String(command.projectId), String(interval.clipId))
  const accessHandle = (await (
    fileHandle as FileSystemFileHandle & {
      createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle>
    }
  ).createSyncAccessHandle()) as FileSystemSyncAccessHandle
  const bytesPerSourceFrame = interval.channelCount * Float32Array.BYTES_PER_ELEMENT
  const interleaved = new Float32Array(AUDIO_READ_CHUNK_FRAMES * interval.channelCount)
  const interleavedBytes = new Uint8Array(interleaved.buffer)
  const mono = new Float32Array(AUDIO_READ_CHUNK_FRAMES)
  let sourcePosition = interval.startSample
  try {
    while (sourcePosition < interval.endSample) {
      assertRequestActive(command.requestId)
      const requestedFrames = Math.min(AUDIO_READ_CHUNK_FRAMES, interval.endSample - sourcePosition)
      const requestedBytes = requestedFrames * bytesPerSourceFrame
      const bytesRead = accessHandle.read(interleavedBytes.subarray(0, requestedBytes), {
        at: sourcePosition * bytesPerSourceFrame,
      })
      if (bytesRead === 0) {
        throw new Error(`Clip ${interval.clipId} ended before the selected source interval`)
      }
      if (bytesRead % bytesPerSourceFrame !== 0) {
        throw new Error(`Clip ${interval.clipId} contains an incomplete interleaved audio frame`)
      }
      const framesRead = bytesRead / bytesPerSourceFrame
      for (let frame = 0; frame < framesRead; ++frame) {
        const channelOffset = frame * interval.channelCount
        let sum = 0
        for (let channel = 0; channel < interval.channelCount; ++channel) {
          sum += interleaved[channelOffset + channel]
        }
        mono[frame] = sum / interval.channelCount
      }
      output.append(resampler.processChunk(new Uint8Array(mono.buffer, 0, framesRead * Float32Array.BYTES_PER_ELEMENT)))
      sourcePosition += framesRead
    }
    output.append(resampler.processChunk(null as unknown as Uint8Array))
    return output.finish()
  } finally {
    accessHandle.close()
  }
}

async function getSoxrWasmBinary(): Promise<ArrayBuffer> {
  if (!soxrWasmPromise) {
    soxrWasmPromise = fetch(SOXR_WASM_URL).then(async (response) => {
      if (!response.ok) {
        throw new Error(`Could not load the audio resampler: HTTP ${response.status}`)
      }
      return response.arrayBuffer()
    })
  }
  try {
    return await soxrWasmPromise
  } catch (error) {
    soxrWasmPromise = null
    throw error
  }
}

function assertRequestActive(requestId: number): void {
  if (activeRequestId !== requestId) {
    throw new DOMException('Transcription cancelled', 'AbortError')
  }
}

async function loadRuntime(command: TranscribeCommand): Promise<GraniteRuntimeState> {
  if (runtimePromise) {
    graniteLog('Reusing the Granite runtime loaded by this worker')
  } else {
    runtimePromise = createRuntime(command)
  }
  try {
    const runtime = await runtimePromise
    postProgress(command.requestId, {
      stage: 'loading',
      progress: 1,
      backend: runtime.backend,
    })
    return runtime
  } catch (error) {
    runtimePromise = null
    throw error
  }
}

async function createRuntime(command: TranscribeCommand): Promise<GraniteRuntimeState> {
  const loadedByName = new Map<AssetName, number>()
  const assets = await traceStage('Asset loading', () =>
    loadPinnedAssets(({ name, loaded }) => {
      loadedByName.set(name, loaded)
      let totalLoaded = 0
      for (const assetLoaded of loadedByName.values()) {
        totalLoaded += assetLoaded
      }
      postProgress(command.requestId, {
        stage: 'download',
        progress: totalLoaded / MODEL_DOWNLOAD_BYTES,
      })
    }),
  )

  ort.env.wasm.wasmPaths = {
    mjs: ortWasmModuleUrl,
    wasm: ortWasmBinaryUrl,
  }
  ort.env.wasm.numThreads =
    command.allowWasmThreads && globalThis.crossOriginIsolated
      ? Math.min(4, Math.max(1, navigator.hardwareConcurrency || 1))
      : 1
  ort.env.webgpu.powerPreference = 'high-performance'

  const canUseWebGpu = command.allowWebGpu && navigator.gpu !== undefined
  let backend: TranscriptionBackend = canUseWebGpu ? 'WebGPU' : 'WASM'
  postProgress(command.requestId, { stage: 'loading', progress: 0, backend })
  graniteLog('ONNX Runtime environment', {
    ortVersion: ort.env.versions.web,
    crossOriginIsolated: globalThis.crossOriginIsolated,
    hardwareConcurrency: navigator.hardwareConcurrency,
    numThreads: ort.env.wasm.numThreads,
    webGpuAvailable: navigator.gpu !== undefined,
    allowWebGpu: command.allowWebGpu,
    allowWasmThreads: command.allowWasmThreads,
  })

  // Silero uses the WASM EP. Creating it first completes ORT's shared runtime
  // initialization without a deadline, so the WebGPU deadline covers only
  // WebGPU setup and a WASM fallback cannot re-enter ORT's initWasm(). ORT
  // creates its pthread pool here, so a pool worker load failure is raced too:
  // the stalled ORT instance is unusable and the main thread restarts the
  // request in a fresh single-threaded worker.
  const vad = await traceStage('ONNX Runtime WASM initialization (Silero VAD session)', () =>
    Promise.race([SileroVad.create(assets[VAD_FILE]), nestedWorkerLoadFailure]),
  )

  let session: ort.InferenceSession
  if (canUseWebGpu) {
    try {
      session = await createWebGpuSessionWithTimeout(assets)
    } catch (error) {
      if (error instanceof WebGpuInitializationTimeoutError) {
        // The abandoned attempt may still resume inside this ORT instance; the
        // main thread retries in a fresh WASM-only worker.
        throw error
      }
      console.warn('[Granite] WebGPU initialization failed; falling back to WASM.', error)
      backend = 'WASM'
      postProgress(command.requestId, { stage: 'loading', progress: 0, backend })
      session = await createAndWarmSession(assets, 'wasm')
    }
  } else {
    session = await createAndWarmSession(assets, 'wasm')
  }

  const config = parseGraniteFrontendConfig(assets['frontend_config.json'])
  const frontend = new GraniteCtcFrontend(
    config,
    createFloat32AssetView(assets['mel_filters.bin'], 'mel_filters.bin'),
    createFloat32AssetView(assets['stft_window.bin'], 'stft_window.bin'),
  )
  const decoder = new GraniteCtcDecoder(
    parseGraniteVocabulary(assets['vocab.json']),
    config.blank_id,
    config.num_special_tokens,
  )
  return { session, backend, frontend, decoder, vad }
}

async function createAndWarmSession(
  assets: LoadedAssets,
  executionProvider: 'webgpu' | 'wasm',
): Promise<ort.InferenceSession> {
  const session = await traceStage(`Granite ${executionProvider} session creation`, () =>
    ort.InferenceSession.create(assets[TIMING_GRAPH_FILE], {
      executionProviders: [executionProvider],
      externalData: [{ path: MODEL_DATA_FILE, data: assets[MODEL_DATA_FILE] }],
      graphOptimizationLevel: 'all',
    }),
  )
  if (executionProvider === 'webgpu') {
    const info = (ort.env.webgpu.adapter as { info?: GPUAdapterInfo } | undefined)?.info
    graniteLog('WebGPU adapter', info && { vendor: info.vendor, architecture: info.architecture })
  }
  try {
    await traceStage(`Granite ${executionProvider} warmup`, () => warmSession(session))
    return session
  } catch (error) {
    await session.release()
    throw error
  }
}

async function createWebGpuSessionWithTimeout(assets: LoadedAssets): Promise<ort.InferenceSession> {
  let timeoutId: number | NodeJS.Timeout = 0
  const sessionPromise = createAndWarmSession(assets, 'webgpu')
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => reject(new WebGpuInitializationTimeoutError()), WEBGPU_INITIALIZATION_TIMEOUT_MS)
  })
  try {
    return await Promise.race([sessionPromise, timeoutPromise])
  } catch (error) {
    if (error instanceof WebGpuInitializationTimeoutError) {
      graniteLog('Granite WebGPU deadline elapsed; the main thread will restart on WASM')
      void sessionPromise.then((session) => session.release()).catch(() => undefined)
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

async function warmSession(session: ort.InferenceSession): Promise<void> {
  const frames = 512
  const featureDimension = 320
  const features = new ort.Tensor('float32', new Float32Array(frames * featureDimension), [1, frames, featureDimension])
  const paddingMask = new ort.Tensor('float32', new Float32Array(frames), [1, frames])
  let outputs: ort.InferenceSession.ReturnType | null = null
  try {
    outputs = await session.run({
      input_features: features,
      padding_mask: paddingMask,
    })
  } finally {
    features.dispose()
    paddingMask.dispose()
    if (outputs) {
      Object.values(outputs).forEach((tensor) => tensor.dispose())
    }
  }
}

async function transcribeGraniteSegment(
  runtime: GraniteRuntimeState,
  audio: Float32Array,
  segmentStart16kSample: number,
  projectSampleRate: number,
  selectedRange: SelectedSourceSampleRange,
  speechMask: Uint8Array,
  energies: Float32Array,
) {
  const input = runtime.frontend.prepareInput(audio)
  if (input.realFrames === 0) {
    return []
  }

  const features = new ort.Tensor('float32', input.data, [1, input.frames, input.dimension])
  const paddingMask = new ort.Tensor('float32', input.paddingMask, [1, input.frames])
  let outputs: ort.InferenceSession.ReturnType | null = null
  try {
    outputs = await runtime.session.run({
      input_features: features,
      padding_mask: paddingMask,
    })
    const frameIds = outputs.frame_ids
    const tokenIds = outputs.token_ids
    const ctcScores = outputs.ctc_scores
    if (!frameIds || !tokenIds || !ctcScores || ctcScores.dims.length !== 2) {
      throw new Error('Granite timing export is missing. Run: yarn prepare:timing')
    }

    const realOutputFrames = graniteRealOutputFrames(input.realFrames)
    if (
      frameIds.data.length < realOutputFrames ||
      ctcScores.dims[0] < realOutputFrames ||
      ctcScores.dims[0] !== frameIds.data.length
    ) {
      throw new Error('Granite timing output does not match its 80 ms frame count')
    }
    const frameData = frameIds.data as BigInt64Array
    const spans = runtime.decoder.decodeTokenSpans(frameData.subarray(0, realOutputFrames))
    const words = runtime.decoder.groupWords(spans)

    const graphTokens = Array.from(tokenIds.data, Number)
    if (graphTokens.length < spans.length || spans.some((span, index) => span.id !== graphTokens[index])) {
      throw new Error('Granite timing token columns do not match the recognized frame path')
    }

    const sourceColumns = ctcScores.dims[1]
    const compactColumns = spans.length + 1
    const sourceScores = ctcScores.data as Float32Array
    if (sourceColumns < compactColumns || sourceScores.length !== ctcScores.dims[0] * sourceColumns) {
      throw new Error('Granite timing output does not match its 80 ms frame count')
    }
    const compactScores = new Float32Array(realOutputFrames * compactColumns)
    for (let frame = 0; frame < realOutputFrames; ++frame) {
      compactScores.set(
        sourceScores.subarray(frame * sourceColumns, frame * sourceColumns + compactColumns),
        frame * compactColumns,
      )
    }
    const posteriors =
      spans.length > 0
        ? ctcTokenPosteriors(
            compactScores,
            realOutputFrames,
            spans.map((span) => span.id),
          )
        : null
    const segmentDurationSeconds = audio.length / GRANITE_SAMPLE_RATE
    let timed = timeGraniteWords(words, posteriors, segmentDurationSeconds)
    if (posteriors !== null) {
      const segmentOffsetSeconds = segmentStart16kSample / GRANITE_SAMPLE_RATE
      timed = timed.map((word) => ({
        ...word,
        start: word.start + segmentOffsetSeconds,
        end: word.end + segmentOffsetSeconds,
      }))
      timed = refineGraniteWords(
        timed,
        speechMask,
        energies,
        SILERO_VAD_FRAME_SAMPLES / SILERO_VAD_SAMPLE_RATE,
        segmentOffsetSeconds,
        (segmentStart16kSample + audio.length) / GRANITE_SAMPLE_RATE,
      ).map((word) => ({
        ...word,
        start: word.start - segmentOffsetSeconds,
        end: word.end - segmentOffsetSeconds,
      }))
    }
    return timedWordsToTranscribedRanges(timed, segmentStart16kSample, projectSampleRate, selectedRange)
  } finally {
    features.dispose()
    paddingMask.dispose()
    if (outputs) {
      Object.values(outputs).forEach((tensor) => tensor.dispose())
    }
  }
}

async function loadPinnedAssets(onProgress: (progress: AssetProgress) => void): Promise<LoadedAssets> {
  const entries = await Promise.all(
    ASSET_NAMES.map(async (name) => [name, await fetchPinnedAsset(name, onProgress)] as const),
  )
  return Object.fromEntries(entries) as LoadedAssets
}

async function fetchPinnedAsset(
  name: AssetName,
  onProgress: (progress: AssetProgress) => void,
): Promise<Uint8Array<ArrayBuffer>> {
  const source = ASSET_SOURCES[name]
  const url = source.url
  const expectedLength = ASSET_MANIFEST[name]
  const cache = typeof caches === 'undefined' ? null : await caches.open(source.cacheName).catch(() => null)
  const cachedResponse = await cache?.match(url).catch(() => undefined)
  graniteLog(`Asset ${name}: ${cachedResponse ? 'cache hit' : cache ? 'cache miss' : 'Cache Storage unavailable'}`)
  if (cachedResponse) {
    try {
      const cachedBytes = new Uint8Array(await cachedResponse.arrayBuffer())
      if (cachedBytes.byteLength !== expectedLength) {
        throw new AssetLengthError(
          `${name} has ${cachedBytes.byteLength.toLocaleString()} cached bytes; expected ${expectedLength.toLocaleString()}`,
        )
      }
      onProgress({ name, loaded: expectedLength })
      return cachedBytes
    } catch (error) {
      console.warn(`[Granite] Discarding an invalid cached asset: ${name}`, error)
      await cache?.delete(url).catch(() => false)
    }
  }

  for (let attempt = 0; attempt < 2; ++attempt) {
    try {
      return await fetchNetworkAsset(name, url, expectedLength, cache, onProgress)
    } catch (error) {
      if (!(error instanceof AssetLengthError) || attempt > 0) {
        throw error
      }
      await cache?.delete(url).catch(() => false)
    }
  }
  throw new Error(`Could not fetch ${name}`)
}

async function fetchNetworkAsset(
  name: AssetName,
  url: string,
  expectedLength: number,
  cache: Cache | null,
  onProgress: (progress: AssetProgress) => void,
): Promise<Uint8Array<ArrayBuffer>> {
  const started = performance.now()
  graniteLog(`Asset ${name}: network request started`)
  const response = await fetch(url)
  graniteLog(`Asset ${name}: HTTP ${response.status}`, {
    host: new URL(response.url).host,
    redirected: response.redirected,
    contentLength: response.headers.get('content-length'),
  })
  if (!response.ok) {
    throw new Error(`Could not download ${name}: HTTP ${response.status}`)
  }

  const declaredLength = Number(response.headers.get('content-length'))
  if (declaredLength > 0 && declaredLength !== expectedLength) {
    await response.body?.cancel()
    throw new AssetLengthError(
      `${name} declares ${declaredLength.toLocaleString()} bytes; expected ${expectedLength.toLocaleString()}`,
    )
  }

  const cacheWrite = cache ? traceCacheWrite(name, cache.put(url, response.clone())) : undefined
  let bytes: Uint8Array<ArrayBuffer>
  try {
    bytes = await readResponseIntoSizedBuffer(response, name, expectedLength, onProgress)
  } catch (error) {
    if (cacheWrite) {
      void cacheWrite.then(() => cache?.delete(url).catch(() => false))
    }
    throw error
  }
  graniteLog(
    `Asset ${name}: downloaded ${bytes.byteLength.toLocaleString()} bytes in ` +
      `${((performance.now() - started) / 1_000).toFixed(2)} s`,
  )
  // Cache persistence is best-effort. Waiting for a 312 MB Cache.put() can
  // otherwise hold the UI at 100% download indefinitely on a wedged cache.
  void cacheWrite
  return bytes
}

async function readResponseIntoSizedBuffer(
  response: Response,
  name: AssetName,
  expectedLength: number,
  onProgress: (progress: AssetProgress) => void,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength !== expectedLength) {
      throw new AssetLengthError(
        `${name} downloaded ${bytes.byteLength.toLocaleString()} bytes; expected ${expectedLength.toLocaleString()}`,
      )
    }
    onProgress({ name, loaded: bytes.byteLength })
    return bytes
  }

  const bytes = new Uint8Array(expectedLength)
  const reader = response.body.getReader()
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    if (loaded + value.byteLength > expectedLength) {
      await reader.cancel()
      throw new AssetLengthError(`${name} downloaded more than ${expectedLength.toLocaleString()} bytes`)
    }
    bytes.set(value, loaded)
    loaded += value.byteLength
    onProgress({ name, loaded })
  }
  if (loaded !== expectedLength) {
    throw new AssetLengthError(
      `${name} downloaded ${loaded.toLocaleString()} bytes; expected ${expectedLength.toLocaleString()}`,
    )
  }
  return bytes
}

function postProgress(
  requestId: number,
  progress: Omit<Extract<TranscriptionWorkerMessage, { type: 'progress' }>, 'type' | 'requestId'>,
): void {
  const message: TranscriptionWorkerMessage = { type: 'progress', requestId, ...progress }
  worker.postMessage(message)
}

function serializeError(error: unknown): SerializedTranscriptionError {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, ...(error.stack ? { stack: error.stack } : {}) }
  }
  return { name: 'Error', message: String(error) }
}

export {}
