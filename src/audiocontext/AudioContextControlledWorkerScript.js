import { ControllableWorkerJobFactory } from './ControllableWorkerJob.ts'

let stopRequested = false

self.onmessage = async (e) => {
  console.debug('Worker got message ' + JSON.stringify(e.data))
  switch (e.data.type) {
    case 'start': {
      const jobId = e.data.jobId
      stopRequested = false
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
        // A stop that arrived while the job was being created found no controllable to stop.
        if (stopRequested) self.controllable.stop()
        await self.controllable.start(reportError)
      } catch (error) {
        reportError(error)
      } finally {
        self.controllable = null
        postMessage({ type: 'finished', jobId })
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
      stopRequested = true
      self.controllable?.stop()
      self.controllable = null
      break
    case 'hqPort': {
      // Loaded on first use, so recordings without meeting guests never load the alignment code.
      const { attachPatchPort } = await import('../recording/HighQualityPatchService.ts')
      attachPatchPort(e.data.port)
      break
    }
  }
}
