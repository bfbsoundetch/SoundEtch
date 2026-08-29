import { RingBuffer } from 'ringbuf.js'
import type { DeepFilterParameters } from './DeepFilterParameters'

export class NoiseReducer {
  private worker: Worker | null = null
  private audioContext: BaseAudioContext | null = null
  private stateChangeListener: (() => void) | null = null
  noiseReducerNode: AudioWorkletNode | null = null

  async start(
    audioContext: BaseAudioContext,
    rawSab: SharedArrayBuffer,
    denoisedSab: SharedArrayBuffer,
    parameters: Partial<DeepFilterParameters> = {},
  ): Promise<boolean> {
    if (!this.worker) {
      const initPromise = Promise.withResolvers<boolean>()
      const startPromise = Promise.withResolvers<boolean>()
      void startPromise.promise.catch(() => {})
      const worker = new Worker(new URL('DenoisingWorker.js', import.meta.url), { type: 'module' })
      this.worker = worker
      worker.postMessage({
        type: 'init',
        parameters,
      })

      worker.onmessage = (e) => {
        switch (e.data.type) {
          case 'initialized':
            initPromise.resolve(true)
            break
          case 'started':
            startPromise.resolve(true)
            break
          case 'error':
            startPromise.reject(e)
            initPromise.reject(e)
            this.dispose()
            break
        }
      }
      worker.onerror = (event) => {
        initPromise.reject(event.error ?? new Error(event.message))
        startPromise.reject(event.error ?? new Error(event.message))
        this.dispose()
      }

      await initPromise.promise
      worker.postMessage({
        type: 'start',
        rawSab: rawSab,
        denoisedSab: denoisedSab,
      })
      await startPromise.promise
    }

    if (this.audioContext && this.stateChangeListener) {
      this.audioContext.removeEventListener('statechange', this.stateChangeListener)
    }
    this.audioContext = audioContext
    this.stateChangeListener = () => {
      switch (audioContext.state) {
        case 'closed': {
          this.dispose()
          break
        }
        case 'suspended': {
          this.worker?.postMessage({ type: 'stop' })
          break
        }
        case 'running':
          this.worker?.postMessage({
            type: 'resume',
            rawSab: rawSab,
            denoisedSab: denoisedSab,
          })
          break
      }
    }
    audioContext.addEventListener('statechange', this.stateChangeListener)

    return true
  }

  async getNoiseReducerNode(
    audioContext: BaseAudioContext,
    rawSab: SharedArrayBuffer,
    denoisedSab: SharedArrayBuffer,
  ): Promise<AudioWorkletNode> {
    if (this.noiseReducerNode) {
      if (audioContext == this.noiseReducerNode.context) {
        return this.noiseReducerNode
      } else {
        this.noiseReducerNode.disconnect()
      }
    }
    await audioContext.audioWorklet.addModule('./assets/ringBufferBackedWorklet.js')

    const result = new AudioWorkletNode(audioContext, 'RingBufferBackedProcessor', {
      processorOptions: {
        rawSab: rawSab,
        denoisedSab: denoisedSab,
      },
      outputChannelCount: [1],
      channelCountMode: 'explicit',
    })

    return (this.noiseReducerNode = result)
  }

  async reduceNoiseFrom(source: AudioNode, parameters: Partial<DeepFilterParameters> = {}): Promise<boolean> {
    const rawSab = RingBuffer.getStorageForCapacity(32 * 1024, Float32Array)
    const denoisedSab = RingBuffer.getStorageForCapacity(32 * 1024, Float32Array)
    if (!(await this.start(source.context, rawSab, denoisedSab, parameters))) {
      return false
    }
    this.noiseReducerNode = await this.getNoiseReducerNode(source.context, rawSab, denoisedSab)
    source.connect(this.noiseReducerNode)
    return true
  }

  disconnect() {
    if (this.audioContext && this.stateChangeListener) {
      this.audioContext.removeEventListener('statechange', this.stateChangeListener)
    }
    this.audioContext = null
    this.stateChangeListener = null
    this.worker?.postMessage({ type: 'stop' })
    this.noiseReducerNode?.disconnect()
  }

  setParameters(parameters: DeepFilterParameters) {
    this.worker?.postMessage({ type: 'configure', parameters })
  }

  dispose() {
    this.disconnect()
    if (this.worker) {
      this.worker.onmessage = null
      this.worker.onerror = null
      this.worker.terminate()
    }
    this.worker = null
    this.noiseReducerNode = null
  }
}
