export const DEEP_FILTER_CACHE_NAME = 'soundetch-cache'

export const GRANITE_MODEL_REVISION = '245e1e52c6fc01ba065c35b4af884d89cdca60de'
export const GRANITE_MODEL_CACHE_NAME = `soundetch-granite-ctc-${GRANITE_MODEL_REVISION}`
export const GRANITE_TIMING_GRAPH_FILE = 'granite_timing_v1_q4f16.onnx'
export const GRANITE_MODEL_DATA_FILE = 'ctc_conformer_q4f16.onnx.data'

export const SILERO_VAD_REVISION = 'e71cae966052b992a7eca6b17738916ce0eca4ec'
export const SILERO_VAD_CACHE_NAME = `soundetch-silero-vad-${SILERO_VAD_REVISION}`
export const SILERO_VAD_FILE = 'silero-vad.onnx'

export const TRANSCRIPTION_ASSET_BYTES = {
  [GRANITE_TIMING_GRAPH_FILE]: 573_789,
  [GRANITE_MODEL_DATA_FILE]: 311_533_568,
  'frontend_config.json': 303,
  'mel_filters.bin': 82_240,
  'stft_window.bin': 2_048,
  'vocab.json': 177_439,
  [SILERO_VAD_FILE]: 639_335,
} as const satisfies Record<string, number>

export const MODEL_CACHE_INFO = [
  { id: 'deepFilterNet', label: 'DeepFilterNet' },
  { id: 'granite', label: 'Granite' },
  { id: 'vad', label: 'Silero VAD' },
] as const

export type ModelCacheId = (typeof MODEL_CACHE_INFO)[number]['id']
export type ModelCacheUsage = Readonly<Record<ModelCacheId, number>>

interface CachedAsset {
  readonly filename: string
  readonly bytes: number
}

interface ModelCacheDefinition {
  readonly cacheNameMatches: (cacheName: string) => boolean
  readonly ownsCache: boolean
  readonly assets: readonly CachedAsset[]
}

const DEEP_FILTER_ASSETS: readonly CachedAsset[] = [
  { filename: 'DeepFilterNet3_onnx.tar.gz', bytes: 7_983_136 },
  { filename: 'df_bg.wasm', bytes: 4_876_732 },
]

const GRANITE_ASSETS: readonly CachedAsset[] = Object.entries(TRANSCRIPTION_ASSET_BYTES)
  .filter(([filename]) => filename != SILERO_VAD_FILE)
  .map(([filename, bytes]) => ({ filename, bytes }))

const MODEL_CACHE_DEFINITIONS: Readonly<Record<ModelCacheId, ModelCacheDefinition>> = {
  deepFilterNet: {
    cacheNameMatches: (cacheName) => cacheName == DEEP_FILTER_CACHE_NAME,
    ownsCache: false,
    assets: DEEP_FILTER_ASSETS,
  },
  granite: {
    cacheNameMatches: (cacheName) => cacheName.startsWith('soundetch-granite-ctc-'),
    ownsCache: true,
    assets: GRANITE_ASSETS,
  },
  vad: {
    cacheNameMatches: (cacheName) => cacheName.startsWith('soundetch-silero-vad-'),
    ownsCache: true,
    assets: [{ filename: 'model_quantized.onnx', bytes: TRANSCRIPTION_ASSET_BYTES[SILERO_VAD_FILE] }],
  },
}

export async function getModelCacheUsage(cacheStorage = getBrowserCacheStorage()): Promise<ModelCacheUsage> {
  const usage: Record<ModelCacheId, number> = { deepFilterNet: 0, granite: 0, vad: 0 }
  const cacheNames = await cacheStorage.keys()
  await Promise.all(
    cacheNames.map(async (cacheName) => {
      for (const { id } of MODEL_CACHE_INFO) {
        const definition = MODEL_CACHE_DEFINITIONS[id]
        if (!definition.cacheNameMatches(cacheName)) continue
        const requests = await (await cacheStorage.open(cacheName)).keys()
        for (const request of requests) {
          const filename = getFilename(request.url)
          const asset = definition.assets.find((candidate) => candidate.filename == filename)
          if (asset !== undefined) usage[id] += asset.bytes
        }
      }
    }),
  )
  return usage
}

export async function unloadModelCache(modelId: ModelCacheId, cacheStorage = getBrowserCacheStorage()): Promise<void> {
  const definition = MODEL_CACHE_DEFINITIONS[modelId]
  const cacheNames = (await cacheStorage.keys()).filter(definition.cacheNameMatches)
  await Promise.all(
    cacheNames.map(async (cacheName) => {
      if (definition.ownsCache) {
        await cacheStorage.delete(cacheName)
        return
      }
      const cache = await cacheStorage.open(cacheName)
      const requests = await cache.keys()
      await Promise.all(
        requests
          .filter((request) => definition.assets.some((asset) => asset.filename == getFilename(request.url)))
          .map((request) => cache.delete(request)),
      )
    }),
  )
}

function getBrowserCacheStorage(): CacheStorage {
  const cacheStorage = (globalThis as typeof globalThis & { caches?: CacheStorage }).caches
  if (cacheStorage === undefined) throw new Error('Browser cache storage is unavailable')
  return cacheStorage
}

function getFilename(url: string): string {
  const pathname = new URL(url).pathname
  return decodeURIComponent(pathname.slice(pathname.lastIndexOf('/') + 1))
}
