import init, { DFRuntimeParams, DFState as WasmDFState } from './wasm/df.js'
import type { InitOutput } from './wasm/df.js'
import { defaultDeepFilterParameters } from './DeepFilterParameters'
import type { DeepFilterParameters } from './DeepFilterParameters'
import { DEEP_FILTER_CACHE_NAME } from '../ModelCache'
import { NetworkUtils } from '../NetworkUtils'

export { defaultDeepFilterParameters, readDeepFilterParameters } from './DeepFilterParameters'
export type { DeepFilterParameters } from './DeepFilterParameters'

let initialization: Promise<{ wasm: InitOutput; modelBytes: Uint8Array }> | null = null

export class DeepFilter {
  readonly frameLength: number

  private memoryBuffer: ArrayBuffer | null = null
  private inputBuffer: Float32Array | null = null
  private outputBuffer: Float32Array | null = null
  private disposed = false

  private constructor(
    private readonly wasm: InitOutput,
    private readonly state: WasmDFState,
    private parameters: DeepFilterParameters,
  ) {
    this.frameLength = state.frame_length
  }

  static async create(parameters: Partial<DeepFilterParameters> = {}) {
    const { wasm, modelBytes } = await (initialization ??= initialize())
    const values = { ...defaultDeepFilterParameters, ...parameters }
    const runtimeParameters = new DFRuntimeParams()
    runtimeParameters.min_db_thresh = values.minDbThreshold
    runtimeParameters.max_db_erb_thresh = values.maxDbErbThreshold
    runtimeParameters.max_db_df_thresh = values.maxDbDfThreshold
    runtimeParameters.post_filter_beta = values.postFilterBeta
    try {
      return new DeepFilter(wasm, new WasmDFState(modelBytes, values.attenuationLimit, runtimeParameters), values)
    } finally {
      runtimeParameters.free()
    }
  }

  getInputBuffer() {
    this.refreshViews()
    return this.inputBuffer!
  }

  getOutputBuffer() {
    this.refreshViews()
    return this.outputBuffer!
  }

  process() {
    this.assertActive()
    const localSnr = this.state.process_frame()
    this.refreshViews()
    return localSnr
  }

  setParameters(parameters: Partial<DeepFilterParameters>) {
    this.assertActive()
    this.parameters = { ...this.parameters, ...parameters }
    this.state.set_atten_lim(this.parameters.attenuationLimit)
    this.state.set_min_db_thresh(this.parameters.minDbThreshold)
    this.state.set_max_db_erb_thresh(this.parameters.maxDbErbThreshold)
    this.state.set_max_db_df_thresh(this.parameters.maxDbDfThreshold)
    this.state.set_post_filter_beta(this.parameters.postFilterBeta)
  }

  dispose() {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.inputBuffer = null
    this.outputBuffer = null
    this.memoryBuffer = null
    this.state.free()
  }

  private refreshViews() {
    this.assertActive()
    if (this.memoryBuffer == this.wasm.memory.buffer) {
      return
    }
    this.memoryBuffer = this.wasm.memory.buffer
    this.inputBuffer = new Float32Array(this.memoryBuffer, this.state.input_ptr(), this.frameLength)
    this.outputBuffer = new Float32Array(this.memoryBuffer, this.state.output_ptr(), this.frameLength)
  }

  private assertActive() {
    if (this.disposed) {
      throw new Error('DeepFilter has been disposed')
    }
  }
}

async function initialize() {
  const [wasmBytes, modelBytes] = await Promise.all([
    getCachedOrFetch(resourceUrl('df_bg.wasm')),
    getCachedOrFetch(resourceUrl('DeepFilterNet3_onnx.tar.gz')),
  ])
  const wasm = await init(wasmBytes)
  return { wasm, modelBytes: new Uint8Array(modelBytes) }
}

function resourceUrl(filename: string) {
  const basePath = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`
  const url = new URL(`noisereduction/${filename}`, new URL(basePath, globalThis.location.origin))
  if (filename == 'df_bg.wasm') {
    url.searchParams.set('v', 'simd-mmm')
  }
  return url.href
}

async function getCachedOrFetch(url: string) {
  console.debug('fetching', url)
  const cache = await caches.open(DEEP_FILTER_CACHE_NAME)
  const cached = await cache.match(url)
  if (cached) {
    return cached.arrayBuffer()
  }
  const response = await NetworkUtils.fetchResource(url, 'noise reduction resource')
  if (!response.ok) {
    throw new Error(`Could not load noise reduction resource from ${url}: HTTP ${response.status}`)
  }
  await cache.put(url, response.clone())
  await deleteSupersededVersions(cache, url)
  return response.arrayBuffer()
}

// A cache-busting version bump leaves the previous build of a resource cached under its old URL.
async function deleteSupersededVersions(cache: Cache, url: string) {
  const { pathname } = new URL(url)
  const requests = await cache.keys()
  await Promise.all(
    requests
      .filter((request) => request.url != url && new URL(request.url).pathname == pathname)
      .map((request) => cache.delete(request)),
  )
}
