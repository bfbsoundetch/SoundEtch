import { ParameterValueSequence } from './ParameterValueSequence'

export interface EffectData {
  /** Stable identity for multiple instances of the same effect. */
  instanceId: string
  id: string
  params: Record<string, ParameterValueSequence>
  state?: unknown
  /** Bypassed effects stay in the chain but their nodes are disconnected from the signal path. */
  bypassed?: boolean
}
