export class LimiterProcessor {
  static readonly parameterDescriptors: AudioParamDescriptor[]
  readonly lookaheadSamples: number
  constructor(options?: AudioWorkletNodeOptions & { processorOptions?: { sampleRate?: number; truePeak?: boolean } })
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean
}
