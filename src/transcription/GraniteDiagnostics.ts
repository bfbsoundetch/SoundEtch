/**
 * Console diagnostics for the Granite transcription worker. Every message is
 * prefixed with the time elapsed since the current request started, and
 * long-running stages log a heartbeat so a stalled stage is identifiable from
 * the DevTools console.
 */
const HEARTBEAT_MS = 5_000

let requestOrigin = performance.now()
const pendingCacheWrites = new Map<string, number>()

function secondsSince(start: number): string {
  return ((performance.now() - start) / 1_000).toFixed(2)
}

export function startGraniteRequestLog(): void {
  requestOrigin = performance.now()
}

/** Plain-object details are inlined as JSON so copied console text stays complete. */
export function graniteLog(message: string, details?: unknown): void {
  const line = `[Granite +${secondsSince(requestOrigin)} s] ${message}`
  if (details === undefined) {
    console.info(line)
  } else if (typeof details === 'object' && details !== null && !(details instanceof Error)) {
    console.info(`${line} ${JSON.stringify(details)}`)
  } else {
    console.info(line, details)
  }
}

export async function traceStage<T>(stage: string, operation: () => Promise<T>): Promise<T> {
  const started = performance.now()
  graniteLog(`${stage}: started`)
  const heartbeat = setInterval(() => {
    const pending = Array.from(pendingCacheWrites, ([name, since]) => `${name} (${secondsSince(since)} s)`)
    graniteLog(
      `${stage}: still running after ${secondsSince(started)} s` +
        (pending.length > 0 ? `; pending cache writes: ${pending.join(', ')}` : ''),
    )
  }, HEARTBEAT_MS)
  try {
    const result = await operation()
    graniteLog(`${stage}: finished in ${secondsSince(started)} s`)
    return result
  } catch (error) {
    graniteLog(`${stage}: failed after ${secondsSince(started)} s`, error)
    throw error
  } finally {
    clearInterval(heartbeat)
  }
}

/** Logs a best-effort cache write; the returned promise always fulfills. */
export function traceCacheWrite(name: string, write: Promise<void>): Promise<void> {
  const started = performance.now()
  pendingCacheWrites.set(name, started)
  graniteLog(`Cache write ${name}: started`)
  return write.then(
    () => {
      pendingCacheWrites.delete(name)
      graniteLog(`Cache write ${name}: finished in ${secondsSince(started)} s`)
    },
    (error: unknown) => {
      pendingCacheWrites.delete(name)
      console.warn(`[Granite] Cache write ${name}: failed after ${secondsSince(started)} s`, error)
    },
  )
}

/** Logs WebAssembly compilation so a stalled compile is distinguishable from stalled ORT startup. */
export function traceWebAssemblyInstantiation(): void {
  const instantiate = WebAssembly.instantiate.bind(WebAssembly) as (...args: unknown[]) => Promise<unknown>
  const instantiateStreaming = WebAssembly.instantiateStreaming.bind(WebAssembly) as (
    ...args: unknown[]
  ) => Promise<unknown>
  WebAssembly.instantiate = ((...args: unknown[]) =>
    traceStage('WebAssembly instantiation', () => instantiate(...args))) as typeof WebAssembly.instantiate
  WebAssembly.instantiateStreaming = ((...args: unknown[]) =>
    traceStage('WebAssembly streaming instantiation', () =>
      instantiateStreaming(...args),
    )) as typeof WebAssembly.instantiateStreaming
}
