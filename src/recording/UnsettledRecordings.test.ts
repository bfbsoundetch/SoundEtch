import { describe, expect, it, vi } from 'vitest'
import { registerUpgrade, withUpgradesPaused } from './UnsettledRecordings'

vi.mock('../audiocontext/AudioControl', () => ({ AudioControl: { stop: async () => {} } }))

const createWork = () => ({ pause: vi.fn(async () => {}), resume: vi.fn() })

describe('withUpgradesPaused', () => {
  it('pauses once and resumes once across nested operations', async () => {
    const work = createWork()
    const unregister = registerUpgrade(work)
    await withUpgradesPaused(async () => {
      await withUpgradesPaused(async () => {})
      expect(work.resume).not.toHaveBeenCalled()
    })
    expect(work.pause).toHaveBeenCalledTimes(1)
    expect(work.resume).toHaveBeenCalledTimes(1)
    unregister()
  })

  it('pauses work registered while paused at once and resumes it once', async () => {
    const work = createWork()
    let unregister = () => {}
    await withUpgradesPaused(async () => {
      unregister = registerUpgrade(work)
      expect(work.pause).toHaveBeenCalledTimes(1)
    })
    expect(work.resume).toHaveBeenCalledTimes(1)
    unregister()
  })

  it('resumes when the operation throws', async () => {
    const work = createWork()
    const unregister = registerUpgrade(work)
    await expect(withUpgradesPaused(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    expect(work.resume).toHaveBeenCalledTimes(1)
    await withUpgradesPaused(async () => {})
    expect(work.pause).toHaveBeenCalledTimes(2)
    unregister()
  })
})
