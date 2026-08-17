import { NoiseReductionEffectMetadata } from '../BuiltinEffectMetadata'
import { EffectModule } from '../Effect'
import { NoiseReducer } from '../../noisereduction/NoiseReducer'
import { createSynchronousNoiseReductionNode } from '../../noisereduction/SynchronousNoiseReductionNode'
import { RingBuffer } from 'ringbuf.js'

export class NoiseReductionEffect implements EffectModule {
  readonly metadata = NoiseReductionEffectMetadata

  private audioContext: BaseAudioContext | null = null
  private node: AudioNode | null = null
  private noiseReducer: NoiseReducer | null = null

  async getNode(audioContext: BaseAudioContext): Promise<AudioNode> {
    if (this.audioContext == audioContext && this.node) {
      return this.node
    }

    this.audioContext = audioContext
    if ('process' in audioContext) {
      this.node = await createSynchronousNoiseReductionNode(audioContext)
      return this.node
    }

    const rawSab = RingBuffer.getStorageForCapacity(32 * 1024, Float32Array)
    const denoisedSab = RingBuffer.getStorageForCapacity(32 * 1024, Float32Array)
    this.noiseReducer = new NoiseReducer()
    this.node = await this.noiseReducer.getNoiseReducerNode(audioContext, rawSab, denoisedSab)
    await this.noiseReducer.start(audioContext, rawSab, denoisedSab)
    return this.node
  }

  async getParameters() {
    return {}
  }
}
