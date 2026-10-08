import {
  DEEP_FILTER_CACHE_NAME,
  GRANITE_MODEL_CACHE_NAME,
  GRANITE_MODEL_DATA_FILE,
  GRANITE_TIMING_GRAPH_FILE,
  SILERO_VAD_CACHE_NAME,
  SILERO_VAD_FILE,
  TRANSCRIPTION_ASSET_BYTES,
  getModelCacheUsage,
  unloadModelCache,
} from './ModelCache'

class FakeCache {
  constructor(readonly urls: string[]) {}

  async keys(): Promise<readonly Request[]> {
    return this.urls.map((url) => new Request(url))
  }

  async delete(request: RequestInfo | URL): Promise<boolean> {
    const url = request instanceof Request ? request.url : String(request)
    const index = this.urls.indexOf(url)
    if (index < 0) return false
    this.urls.splice(index, 1)
    return true
  }
}

class FakeCacheStorage {
  readonly caches = new Map<string, FakeCache>()

  add(name: string, urls: string[]): void {
    this.caches.set(name, new FakeCache(urls))
  }

  async keys(): Promise<string[]> {
    return Array.from(this.caches.keys())
  }

  async open(name: string): Promise<Cache> {
    let cache = this.caches.get(name)
    if (cache === undefined) {
      cache = new FakeCache([])
      this.caches.set(name, cache)
    }
    return cache as unknown as Cache
  }

  async delete(name: string): Promise<boolean> {
    return this.caches.delete(name)
  }
}

test('reports cached model bytes and unloads only each model cache', async () => {
  const storage = new FakeCacheStorage()
  const deepFilterModelUrl = 'https://soundetch.test/soundetch/noisereduction/DeepFilterNet3_onnx.tar.gz'
  const deepFilterWasmUrl = 'https://soundetch.test/soundetch/noisereduction/df_bg.wasm?v=dfstate-api'
  const unrelatedUrl = 'https://soundetch.test/soundetch/other-resource.bin'
  storage.add(DEEP_FILTER_CACHE_NAME, [deepFilterModelUrl, deepFilterWasmUrl, unrelatedUrl])
  storage.add(GRANITE_MODEL_CACHE_NAME, [
    `https://models.test/${GRANITE_MODEL_DATA_FILE}`,
    'https://models.test/vocab.json',
  ])
  storage.add('soundetch-granite-ctc-old-revision', [`https://soundetch.test/granite/${GRANITE_TIMING_GRAPH_FILE}`])
  storage.add(SILERO_VAD_CACHE_NAME, ['https://models.test/model_quantized.onnx'])

  await expect(getModelCacheUsage(storage as unknown as CacheStorage)).resolves.toEqual({
    deepFilterNet: 7_983_136 + 4_876_732,
    granite:
      TRANSCRIPTION_ASSET_BYTES[GRANITE_MODEL_DATA_FILE] +
      TRANSCRIPTION_ASSET_BYTES['vocab.json'] +
      TRANSCRIPTION_ASSET_BYTES[GRANITE_TIMING_GRAPH_FILE],
    vad: TRANSCRIPTION_ASSET_BYTES[SILERO_VAD_FILE],
  })

  await unloadModelCache('granite', storage as unknown as CacheStorage)
  expect(storage.caches.has(GRANITE_MODEL_CACHE_NAME)).toBe(false)
  expect(storage.caches.has('soundetch-granite-ctc-old-revision')).toBe(false)
  expect(storage.caches.has(SILERO_VAD_CACHE_NAME)).toBe(true)

  await unloadModelCache('deepFilterNet', storage as unknown as CacheStorage)
  expect(storage.caches.get(DEEP_FILTER_CACHE_NAME)?.urls).toEqual([unrelatedUrl])

  await unloadModelCache('vad', storage as unknown as CacheStorage)
  expect(storage.caches.has(SILERO_VAD_CACHE_NAME)).toBe(false)
})
