import { expect, test, vi } from 'vitest'

const { creation, job } = vi.hoisted(() => {
  const stopped = Promise.withResolvers<void>()
  return {
    creation: Promise.withResolvers<unknown>(),
    // Like a recording, the job runs until it is stopped.
    job: {
      start: vi.fn(() => stopped.promise),
      stop: vi.fn(() => stopped.resolve()),
      pause: vi.fn(),
      resume: vi.fn(),
    },
  }
})

vi.mock('./ControllableWorkerJob.ts', () => ({
  ControllableWorkerJobFactory: { getControllableWorkerJob: vi.fn(() => creation.promise) },
}))

test('a stop that arrives while the job is being created stops it, and the job reports its id when finished', async () => {
  const postMessage = vi.fn()
  Object.assign(globalThis, { self: globalThis, postMessage })
  // Imported after `self` exists: the script assigns `self.onmessage` when it loads.
  await import('./AudioContextControlledWorkerScript.js')
  const worker = globalThis as unknown as { onmessage: (event: { data: unknown }) => Promise<void> }

  const running = worker.onmessage({ data: { type: 'start', jobId: 7, jobType: 'recorder', argument: [] } })
  void worker.onmessage({ data: { type: 'stop' } })
  creation.resolve(job)
  await running

  expect(job.stop).toHaveBeenCalled()
  expect(job.start).toHaveBeenCalled()
  expect(postMessage).toHaveBeenCalledWith({ type: 'finished', jobId: 7 })
})
