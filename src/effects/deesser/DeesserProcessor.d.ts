export class DeesserProcessor {
  static readonly parameterDescriptors: AudioParamDescriptor[]
  constructor(options?: AudioWorkletNodeOptions & { processorOptions?: { sampleRate?: number } })
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean
}
