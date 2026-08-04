import { ParameterMetadata } from './ParameterMetadata'

export interface EffectModule {
  readonly metadata: EffectMetadata
  getNode(audioContext: BaseAudioContext): Promise<AudioNode>
  getParameters(audioContext: BaseAudioContext): Promise<Record<string, AudioParam>>
}

export interface EffectMetadata {
  id: string
  name: string
  description: string
  categories: string[]
  parameters: ParameterMetadata[]
}
