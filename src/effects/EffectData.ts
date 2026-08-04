import { ParameterValueSequence } from './ParameterValueSequence'

export interface EffectData {
  /** Stable identity for multiple instances of the same effect. */
  instanceId: string
  id: string
  params: Record<string, ParameterValueSequence>
}
