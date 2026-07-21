export interface EffectData {
  /** Identifies records whose state must be persisted as opaque WAM data. */
  wamPluginEffect?: true
  /** Stable identity for multiple instances of the same plugin. */
  instanceId?: string
  id: string
  state: unknown
  automation: Array<{}>
}
