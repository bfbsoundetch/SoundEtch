import { fileURLToPath } from 'url'
import { build, type Rollup } from 'vite'
import { expect, test } from 'vitest'

/**
 * Minified bytes of the JavaScript that index.html loads before any interaction: its entry chunk and every chunk that
 * chunk statically imports. Code behind a dynamic import() is excluded. Heavy features and libraries (media import,
 * recording, video decoding, publishing, meetings) belong behind dynamic import(); raise this only for deliberate growth.
 */
const INITIAL_JAVASCRIPT_BUDGET_BYTES = 550_000

test('index.html loads no more JavaScript up front than the budget', { timeout: 120_000 }, async () => {
  const previousNodeEnv = process.env.NODE_ENV
  // Vitest sets NODE_ENV=test; measure what `yarn build` ships.
  process.env.NODE_ENV = 'production'
  let result: Rollup.RollupOutput | Rollup.RollupOutput[] | Rollup.RollupWatcher
  try {
    result = await build({
      configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
      mode: 'production',
      logLevel: 'silent',
      build: { write: false },
    })
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousNodeEnv
  }
  // Without build.watch, vite returns outputs rather than a watcher.
  const output = (Array.isArray(result) ? result : [result as Rollup.RollupOutput]).flatMap((build) => build.output)
  const chunks = new Map(
    output.filter((item): item is Rollup.OutputChunk => item.type === 'chunk').map((chunk) => [chunk.fileName, chunk]),
  )
  const indexHtml = fileURLToPath(new URL('../index.html', import.meta.url))
  const entry = [...chunks.values()].find((chunk) => chunk.isEntry && chunk.facadeModuleId === indexHtml)
  expect(entry, 'index.html entry chunk').toBeDefined()

  const initial = new Set<Rollup.OutputChunk>()
  const visit = (chunk: Rollup.OutputChunk) => {
    if (initial.has(chunk)) return
    initial.add(chunk)
    for (const fileName of chunk.imports) visit(chunks.get(fileName)!)
  }
  visit(entry!)

  const bytes = [...initial].reduce((total, chunk) => total + Buffer.byteLength(chunk.code), 0)
  const largestModules = [...initial]
    .flatMap((chunk) => Object.entries(chunk.modules))
    .sort(([, a], [, b]) => b.renderedLength - a.renderedLength)
    .slice(0, 15)
    .map(([id, module]) => `  ${module.renderedLength} ${id.replace(/^.*?(node_modules|src)\//, '$1/')}`)
  expect(
    bytes,
    `Initial chunks ${[...initial].map((chunk) => chunk.fileName).join(', ')} total ${bytes} bytes. ` +
      `Largest modules (unminified bytes):\n${largestModules.join('\n')}`,
  ).toBeLessThanOrEqual(INITIAL_JAVASCRIPT_BUDGET_BYTES)
})
