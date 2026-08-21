import { createAudioWorkletProcessorScriptNode } from '../../audiocontext/AudioWorkletProcessorScriptNode'
import { LimiterEffectMetadata } from '../BuiltinEffectMetadata'
import { EffectModule } from '../Effect'
import { LimiterProcessor } from './LimiterProcessor'

export class LimiterEffect implements EffectModule {
  readonly metadata = LimiterEffectMetadata

  private audioContext: BaseAudioContext | null = null
  private node: AudioNode | null = null
  private parameters: Record<string, AudioParam> | null = null

  async connect(audioContext: BaseAudioContext, destination: AudioNode): Promise<AudioNode> {
    const node = await this.getNode(audioContext)
    node.connect(destination)
    return node
  }

  disconnect() {
    this.node?.disconnect()
  }

  async getParameters(audioContext: BaseAudioContext) {
    await this.getNode(audioContext)
    return this.parameters!
  }

  private async getNode(audioContext: BaseAudioContext): Promise<AudioNode> {
    if (this.audioContext == audioContext && this.node) return this.node

    this.disconnect()
    this.audioContext = audioContext

    let node
    if ((audioContext as any).blockSize) {
      node = createAudioWorkletProcessorScriptNode(audioContext, LimiterProcessor, {
        processorOptions: { sampleRate: audioContext.sampleRate },
      })
      this.parameters = Object.fromEntries(node.parameters)
    } else {
      await audioContext.audioWorklet.addModule(new URL('./LimiterProcessor.js', import.meta.url))
      node = new AudioWorkletNode(audioContext, 'soundetch-limiter')
      const parameters = node.parameters as unknown as Map<string, AudioParam>
      this.parameters = {
        ceiling: parameters.get('ceiling')!,
        release: parameters.get('release')!,
      }
    }

    node.channelCountMode = 'max'
    this.node = node as AudioNode

    return node as AudioNode
  }
}
