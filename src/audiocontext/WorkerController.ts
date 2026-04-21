import { JobType } from './ControllableWorkerJob'
import { Logger } from '../global/Logger'

export class WorkerController {
  private audioWorkletNodes = new Array<AudioWorkletNode>()
  readonly worker: Worker
  private readonly logger = new Logger('WorkerController')

  constructor(options?: WorkerOptions) {
    // https://v3.vitejs.dev/guide/features.html#import-with-constructors
    // They don't really tell you that it _has_ to look like this
    // e.g. making WorkerController extend worker and call super doesn't work!!
    this.worker = new Worker(new URL('./AudioContextControlledWorkerScript.js', import.meta.url), {
      ...options,
      type: 'module',
    })
    this.worker.addEventListener('message', async (event) => {
      this.logger.debug('worker sent ' + Object.keys(event.data))
      switch (event.data.type) {
        case 'finished':
          this.audioWorkletNodes.forEach((node) =>
            node.port.postMessage({
              type: 'finished',
            }),
          )
          break
        case 'ready':
          {
            const audioContext = this.audioWorkletNodes[0]?.context
            if ((audioContext as any)?.startRendering) {
              this.logger.error('really rendering')
              ;(audioContext as any)?.startRendering?.()
            } else {
              await (audioContext as any)?.resume?.()
            }
          }
          break
        case 'error':
          {
            const audioContext = this.audioWorkletNodes[0]?.context
            if ((audioContext as any)?.close) {
              await (audioContext as any).close()
            } else {
              await (audioContext as any).suspend()
            }
          }
          break
      }
    })
  }

  setAudioWorkletNode(audioWorkletNodes: Array<AudioWorkletNode>) {
    this.audioWorkletNodes = audioWorkletNodes
    audioWorkletNodes.forEach((node) =>
      node.port.addEventListener('message', (e) => {
        node.addEventListener('processorerror', (e) => {
          this.logger.error(e.error?.toString?.() ?? String(e.error))
          ;(audioContext as any)?.close?.() ?? (audioContext as any)?.suspend()
        })
      }),
    )
    const context = audioWorkletNodes[0]!.context
    context.addEventListener('statechange', () => {
      this.logger.debug('Audio context state is now ' + context.state)
      switch (context.state) {
        case 'closed':
          this.worker.postMessage({ type: 'stop' })
          break
        case 'running':
          this.worker.postMessage({ type: 'resume' })
          break
        case 'suspended':
          this.worker.postMessage({ type: 'pause' })
          break
      }
    })
  }

  finish() {
    this.logger.debug('Worker is finished.')
    this.audioWorkletNodes.forEach((node) =>
      node.port.postMessage({
        type: 'finished',
      }),
    )
    this.audioWorkletNodes = []
  }

  start(jobType: JobType, argument: any, transferables: Transferable[] = []) {
    this.logger.debug('Starting worker')
    this.worker.postMessage(
      {
        type: 'start',
        jobType: jobType,
        argument: argument,
      },
      transferables,
    )
  }
}
