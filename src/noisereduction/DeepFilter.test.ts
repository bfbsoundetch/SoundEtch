afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

test.each([
  ['/', 'https://soundetch.test/noisereduction/'],
  ['/soundetch/', 'https://soundetch.test/soundetch/noisereduction/'],
  ['/soundetch', 'https://soundetch.test/soundetch/noisereduction/'],
  ['https://assets.soundetch.test/app/', 'https://assets.soundetch.test/app/noisereduction/'],
])('requests DeepFilter assets under deployment base %s', async (base, resourceBase) => {
  vi.resetModules()
  vi.stubEnv('BASE_URL', base)
  vi.stubGlobal('location', { origin: 'https://soundetch.test' })
  vi.stubGlobal('caches', {
    open: async () => ({ match: async () => undefined }),
  })
  const fetchResource = vi.fn(async () => new Response(null, { status: 404 }))
  vi.stubGlobal('fetch', fetchResource)
  // A fresh module is required because DeepFilter retains its initialization promise between calls.
  const { DeepFilter } = await import('./DeepFilter')

  await expect(DeepFilter.create()).rejects.toThrow()

  expect(fetchResource.mock.calls).toEqual([
    [`${resourceBase}df_bg.wasm?v=simd-mmm`],
    [`${resourceBase}DeepFilterNet3_onnx.tar.gz`],
  ])
})

test('drops the DeepFilter wasm cached by an earlier version once the current one is fetched', async () => {
  vi.resetModules()
  vi.stubEnv('BASE_URL', '/')
  vi.stubGlobal('location', { origin: 'https://soundetch.test' })
  const resourceBase = 'https://soundetch.test/noisereduction/'
  const modelUrl = `${resourceBase}DeepFilterNet3_onnx.tar.gz`
  const unrelatedUrl = `${resourceBase}other.bin`
  const cachedUrls = [`${resourceBase}df_bg.wasm?v=dfstate-api`, modelUrl, unrelatedUrl]
  vi.stubGlobal('caches', {
    open: async () => ({
      match: async (url: string) => (cachedUrls.includes(url) ? new Response(new Uint8Array(1)) : undefined),
      put: async (url: string) => void cachedUrls.push(url),
      keys: async () => cachedUrls.map((url) => new Request(url)),
      delete: async (request: Request) => cachedUrls.splice(cachedUrls.indexOf(request.url), 1).length > 0,
    }),
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(new Uint8Array(1))),
  )
  const { DeepFilter } = await import('./DeepFilter')

  // The stub bytes are not a WebAssembly module, so initialization fails after caching.
  await expect(DeepFilter.create()).rejects.toThrow()

  expect(cachedUrls).toEqual([modelUrl, unrelatedUrl, `${resourceBase}df_bg.wasm?v=simd-mmm`])
})
