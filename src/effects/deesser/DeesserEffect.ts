import { createAudioWorkletProcessorScriptNode } from '../../audiocontext/AudioWorkletProcessorScriptNode'
import { DeesserEffectMetadata } from '../BuiltinEffectMetadata'
import type { EffectModule } from '../Effect'
import { DeesserProcessor } from './DeesserProcessor'

export class DeesserEffect implements EffectModule {
  readonly metadata = DeesserEffectMetadata

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
    if ('blockSize' in audioContext) {
      node = createAudioWorkletProcessorScriptNode(audioContext, DeesserProcessor, {
        processorOptions: { sampleRate: audioContext.sampleRate },
      })
      this.parameters = Object.fromEntries(node.parameters)
    } else {
      await audioContext.audioWorklet.addModule(new URL('./DeesserProcessor.js', import.meta.url))
      node = new AudioWorkletNode(audioContext, 'soundetch-deesser')
      this.parameters = Object.fromEntries(node.parameters as unknown as Map<string, AudioParam>)
    }

    node.channelCountMode = 'max'
    this.node = node as AudioNode

    return node as AudioNode
  }
}
