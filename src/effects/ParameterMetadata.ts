export interface ParameterMetadata {
  id: string
  displayName: string
  defaultValue: number
  minValue: number
  maxValue: number
  increment?: number
  normalize: (_: number) => number
  denormalize: (_: number) => number
  displayValue: (_: number) => string
}
