import { ControllableWorkerJobFactory } from './ControllableWorkerJob.ts'

self.onmessage = async (e) => {
  console.debug('Worker got message ' + JSON.stringify(e.data))
  switch (e.data.type) {
    case 'start':
      self.controllable = await ControllableWorkerJobFactory.getControllableWorkerJob(e.data.jobType, e.data.argument)
      await self.controllable.start()
      postMessage({
        type: 'finished',
      })
      break
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
