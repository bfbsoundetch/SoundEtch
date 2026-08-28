import { ParameterMetadata } from './ParameterMetadata'

export interface EffectEditorContext {
  readonly signal: AbortSignal
  commit(parameters: Readonly<Record<string, number>>, state: unknown, description: string): Promise<void>
}

export interface EffectModule {
  readonly metadata: EffectMetadata
  connect(audioContext: BaseAudioContext, destination: AudioNode): Promise<AudioNode>
  disconnect(): void
  getParameters(audioContext: BaseAudioContext): Promise<Record<string, AudioParam>>
  setState?(state: unknown): void
  createEditor?(context: EffectEditorContext): Promise<HTMLElement | null>
}

export interface EffectMetadata {
  id: string
  name: string
  description: string
  categories: string[]
  parameters: ParameterMetadata[]
  createDefaultState?: () => unknown
}
