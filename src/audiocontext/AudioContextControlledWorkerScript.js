import { ControllableWorkerJobFactory } from './ControllableWorkerJob.ts'

self.onmessage = async (e) => {
  console.debug('Worker got message ' + JSON.stringify(e.data))
  switch (e.data.type) {
    case 'start': {
      let failed = false
      const reportError = (error) => {
        if (failed) return
        failed = true
        postMessage({
          type: 'error',
          error: {
            name: typeof error?.name === 'string' ? error.name : 'Error',
            message: typeof error?.message === 'string' ? error.message : String(error),
          },
        })
      }
      try {
        self.controllable = await ControllableWorkerJobFactory.getControllableWorkerJob(e.data.jobType, e.data.argument)
        await self.controllable.start(reportError)
      } catch (error) {
        reportError(error)
      } finally {
        self.controllable = null
        postMessage({ type: 'finished' })
      }
      break
    }
    case 'pause':
      self.controllable?.pause()
      break
    case 'resume':
      self.controllable?.resume()
      break
    case 'stop':
      self.controllable?.stop()
      self.controllable = null
      break
  }
}
