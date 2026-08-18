import { ParameterMetadata } from './ParameterMetadata'

export interface EffectModule {
  readonly metadata: EffectMetadata
  connect(audioContext: BaseAudioContext, destination: AudioNode): Promise<AudioNode>
  disconnect(): void
  getParameters(audioContext: BaseAudioContext): Promise<Record<string, AudioParam>>
}

export interface EffectMetadata {
  id: string
  name: string
  description: string
  categories: string[]
  parameters: ParameterMetadata[]
}
