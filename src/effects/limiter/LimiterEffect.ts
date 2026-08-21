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
      node = audioContext.createScriptProcessor((audioContext as any).blockSize)
      const processor = new LimiterProcessor()
      const ceilingNode = audioContext.createGain()
      const releaseNode = audioContext.createGain()
      const ceilingSource = audioContext.createConstantSource()
      const releaseSource = audioContext.createConstantSource()
      ceilingSource.offset.value = 0
      releaseSource.offset.value = 0
      ceilingSource.connect(ceilingNode).connect(audioContext.destination)
      releaseSource.connect(releaseNode).connect(audioContext.destination)
      ceilingSource.start()
      releaseSource.start()
      this.parameters = {
        ceiling: ceilingNode.gain,
        release: releaseNode.gain,
      }
      this.parameters!.ceiling.setValueAtTime(0, audioContext.currentTime)
      const inputs = [[new Float32Array(), new Float32Array()]]
      const outputs = [[new Float32Array(), new Float32Array()]]
      node.onaudioprocess = (event) => {
        inputs[0][0] = event.inputBuffer.getChannelData(0)
        inputs[0][1] = event.inputBuffer.getChannelData(1) ?? inputs[0][1]
        outputs[0][0] = event.outputBuffer.getChannelData(0)
        outputs[0][1] = event.outputBuffer.getChannelData(1) ?? outputs[0][1]


        let ceilingArray, releaseArray
        if ((this.parameters!.ceiling as any)._impl.hasSampleAccurateValues()) {
          ceilingArray = (this.parameters!.ceiling as any)._impl.getSampleAccurateValues()
        } else {
          ceilingArray = new Float32Array(1)
          ceilingArray[0] = this.parameters!.ceiling.value
        }

        if ((this.parameters!.release as any)._impl._hasSampleAccurateValues) {
          releaseArray = (this.parameters!.release as any)._impl.getSampleAccurateValues()
        } else {
          releaseArray = new Float32Array(1)
          releaseArray[0] = this.parameters!.release.value
        }

        processor.process(inputs, outputs, {'ceiling': ceilingArray, 'release': releaseArray})
      }
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
