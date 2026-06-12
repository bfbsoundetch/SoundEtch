import { RingBuffer } from 'ringbuf.js'

export class NoiseReducer {
  private worker: Worker | null = null
  noiseReducerNode: AudioWorkletNode | null = null

  private async prepareWorker(
    audioContext: BaseAudioContext,
    rawSab: SharedArrayBuffer,
    denoisedSab: SharedArrayBuffer,
  ): Promise<boolean> {
    if (!this.worker) {
      const initPromise = Promise.withResolvers()
      const startPromise = Promise.withResolvers()
      this.worker = new Worker(new URL('DenoisingWorker.js', import.meta.url), { type: 'module' })
      this.worker.postMessage({
        type: 'init',
      })

      this.worker.onmessage = (e) => {
        switch (e.data.type) {
          case 'initialized':
            initPromise.resolve(true)
            break
          case 'started':
            startPromise.resolve(true)
            break
          case 'error':
            //TODO: do something with the node
            startPromise.reject(e)
            initPromise.reject(e)
            this.disconnect()
            break
        }
      }

      await initPromise.promise
      this.worker.postMessage({
        type: 'start',
        rawSab: rawSab,
        denoisedSab: denoisedSab,
      })
      await startPromise.promise
    }

    audioContext.addEventListener('statechange', () => {
      switch (audioContext.state) {
        case 'closed': {
          this.worker?.postMessage({ type: 'stop' })
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
    })

    return true
  }

  private async getNoiseReducerNode(
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

    return result
  }

  async reduceNoiseFrom(source: AudioNode): Promise<boolean> {
    const rawSab = RingBuffer.getStorageForCapacity(32 * 1024, Float32Array)
    const denoisedSab = RingBuffer.getStorageForCapacity(32 * 1024, Float32Array)
    if (!(await this.prepareWorker(source.context, rawSab, denoisedSab))) {
      return false
    }
    this.noiseReducerNode = await this.getNoiseReducerNode(source.context, rawSab, denoisedSab)
    source.connect(this.noiseReducerNode)
    return true
  }

  disconnect() {
    this.worker?.postMessage({ type: 'stop' })
    this.noiseReducerNode?.disconnect()
  }

  private async getCachedOrFetch(url: string) {
    const cache = await caches.open('soundetch-cache')
    const cached = await cache.match(url)
    if (cached) {
      return cached.arrayBuffer()
    }
    const fetchResponse = await fetch(url)
    await cache.put(url, fetchResponse.clone())
    return fetchResponse.arrayBuffer()
  }
}
