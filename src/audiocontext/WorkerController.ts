import { JobType } from './ControllableWorkerJob'
import { Logger } from '../global/Logger'
import { NotificationsController } from '../ui/NotificationsController'
import { AudioControl } from './AudioControl'

export class WorkerController {
  private audioWorkletNodes = new Array<AudioWorkletNode>()
  private onError: ((error: Error) => void) | null = null
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
      this.logger.debug(
        'worker sent {' +
          Object.keys(event.data)
            .map((k) => `${k}: ${JSON.stringify(event.data[k]).substring(0, 100)}`)
            .join('\n') +
          '}',
      )
      switch (event.data.type) {
        case 'finished':
          this.finish()
          break
        case 'ready':
          {
            const audioContext = this.audioWorkletNodes[0]?.context
            if ((audioContext as any)?.startRendering) {
              this.logger.errorMessage('really rendering')
              ;(audioContext as any)?.startRendering?.()
            } else {
              await (audioContext as any)?.resume?.()
            }
          }
          break
        case 'error':
          this.handleError(
            new DOMException(
              event.data.error?.message ?? 'Audio processing failed.',
              event.data.error?.name ?? 'Error',
            ),
          )
          break
      }
    })
  }

  setAudioWorkletNodes(
    audioWorkletNodes: Array<AudioWorkletNode>,
    onError: ((error: Error) => void) | null = null,
  ) {
    this.onError = onError
    this.audioWorkletNodes = audioWorkletNodes
    let finishedNodes = 0
    const context = audioWorkletNodes[0]!.context as AudioContext
    audioWorkletNodes.forEach((node) => {
      node.port.onmessage = (e) => {
        if (e.data.type == 'finished') {
          if (++finishedNodes == audioWorkletNodes.length) {
            context.close()
          }
        }
      }
      node.addEventListener('processorerror', () => {
        this.handleError(new Error('Audio processing failed.'))
      })
    })
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

  private handleError(error: Error) {
    this.logger.error(error)
    if (this.onError) {
      this.onError(error)
      return
    }
    NotificationsController.showErrorMessage('Audio processing failed.')
    const audioContext = this.audioWorkletNodes[0]?.context
    if (audioContext && 'close' in audioContext) {
      void (audioContext as AudioContext).close()
    } else if (audioContext && 'suspend' in audioContext) {
      void (audioContext as AudioContext).suspend()
    }
  }

  finish() {
    this.logger.debug('Worker is finished.')
    this.audioWorkletNodes.forEach((node) => {
      node.port.postMessage({
        type: 'finished',
      })
    })
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
