import * as wasm_bindgen from './wasm/df_bg.js'

type DeepFilterWasm = WebAssembly.Exports & {
  memory: WebAssembly.Memory
}

let initialization: Promise<{ wasm: DeepFilterWasm; modelBytes: Uint8Array }> | null = null

export class DeepFilter {
  readonly frameLength: number

  private constructor(
    private readonly wasm: DeepFilterWasm,
    private readonly state: number,
    private readonly inputPointer: number,
    private readonly outputPointer: number,
  ) {
    this.frameLength = wasm_bindgen.df_get_frame_length(state)
  }

  static async create() {
    const { wasm, modelBytes } = await (initialization ??= initialize())
    const state = wasm_bindgen.df_create(modelBytes, 100)
    const frameLength = wasm_bindgen.df_get_frame_length(state)
    return new DeepFilter(
      wasm,
      state,
      wasm_bindgen.df_create_frame_buffer(frameLength),
      wasm_bindgen.df_create_frame_buffer(frameLength),
    )
  }

  getInputBuffer() {
    return new Float32Array(this.wasm.memory.buffer).subarray(
      this.inputPointer / Float32Array.BYTES_PER_ELEMENT,
      this.inputPointer / Float32Array.BYTES_PER_ELEMENT + this.frameLength,
    )
  }

  getOutputBuffer() {
    return new Float32Array(this.wasm.memory.buffer).subarray(
      this.outputPointer / Float32Array.BYTES_PER_ELEMENT,
      this.outputPointer / Float32Array.BYTES_PER_ELEMENT + this.frameLength,
    )
  }

  process(input: Float32Array, output: Float32Array) {
    if (input.length != this.frameLength || output.length != this.frameLength) {
      throw new Error(`DeepFilter frames must contain ${this.frameLength} samples`)
    }

    wasm_bindgen.df_process_frame2(this.state, this.inputPointer, this.outputPointer)
  }
}

async function initialize() {
  const [wasmBytes, modelBytes] = await Promise.all([
    getCachedOrFetch(resourceUrl('df_bg.wasm')),
    getCachedOrFetch(resourceUrl('DeepFilterNet3_onnx.tar.gz')),
  ])
  const instance = await WebAssembly.instantiate(wasmBytes, { './df_bg.js': wasm_bindgen })
  const wasm = instance.instance.exports as DeepFilterWasm
  wasm_bindgen.__wbg_set_wasm(wasm)
  return { wasm, modelBytes: new Uint8Array(modelBytes) }
}

function resourceUrl(filename: string) {
  const env = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env
  return new URL(`${env?.BASE_URL ?? ''}/noisereduction/${filename}`, globalThis.location.origin).href
}

async function getCachedOrFetch(url: string) {
  console.debug('fetching', url)
  const cache = await caches.open('soundetch-cache')
  const cached = await cache.match(url)
  if (cached) {
    return cached.arrayBuffer()
  }
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Could not load noise reduction resource: ${response.status} ${response.statusText}`)
  }
  await cache.put(url, response.clone())
  return response.arrayBuffer()
}
