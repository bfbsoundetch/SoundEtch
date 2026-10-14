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
    [`${resourceBase}df_bg.wasm?v=dfstate-api`],
    [`${resourceBase}DeepFilterNet3_onnx.tar.gz`],
  ])
})
