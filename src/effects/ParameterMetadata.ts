export interface ParameterMetadata {
    name: string
    minValue: number
    maxValue: number
    increment?: number
    units: string
    normalize: (_: number) => number
    denormalize: (_: number) => number
}