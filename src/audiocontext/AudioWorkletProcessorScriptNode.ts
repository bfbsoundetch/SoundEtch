import { api, impl } from '@descript/web-audio-js'

export interface AudioWorkletProcessorImplementation {
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean
}

export interface AudioWorkletParameterDescriptor {
  readonly name: string
  readonly defaultValue?: number
  readonly minValue?: number
  readonly maxValue?: number
  readonly automationRate?: AutomationRate
}

export interface AudioWorkletProcessorConstructor {
  readonly parameterDescriptors?: readonly AudioWorkletParameterDescriptor[]
  new (options?: AudioWorkletNodeOptions): AudioWorkletProcessorImplementation
}

export type AudioWorkletProcessorScriptNode = ScriptProcessorNode & {
  readonly parameters: ReadonlyMap<string, AudioParam>
}

interface WebAudioJsAudioParamImplementation {
  dspProcess(): void
  getValue(): number
  hasSampleAccurateValues(): boolean
  getSampleAccurateValues(): Float32Array
}

interface WebAudioJsContext extends BaseAudioContext {
  readonly blockSize: number
  readonly numberOfChannels?: number
  readonly _impl: unknown
}

export function createAudioWorkletProcessorScriptNode(
  audioContext: BaseAudioContext,
  Processor: AudioWorkletProcessorConstructor,
  options: AudioWorkletNodeOptions = {},
): AudioWorkletProcessorScriptNode {
  if (options.numberOfInputs != null && options.numberOfInputs != 1) {
    throw new Error('ScriptProcessorNode supports exactly one input')
  }
  if (options.numberOfOutputs != null && options.numberOfOutputs != 1) {
    throw new Error('ScriptProcessorNode supports exactly one output')
  }

  const context = audioContext as WebAudioJsContext
  const inputChannelCount = options.channelCount ?? context.numberOfChannels ?? 1
  const outputChannelCount = options.outputChannelCount?.[0] ?? inputChannelCount
  const node = audioContext.createScriptProcessor(context.blockSize, inputChannelCount, outputChannelCount)
  const processor = new Processor(options)
  const parameters = new Map<string, AudioParam>()
  const parameterImplementations = new Map<string, WebAudioJsAudioParamImplementation>()
  const parameterDescriptors = Processor.parameterDescriptors ?? []

  for (const descriptor of parameterDescriptors) {
    const parameterImplementation = new impl.AudioParam(context._impl, {
      rate: descriptor.automationRate == 'k-rate' ? 'control' : 'audio',
      defaultValue: descriptor.defaultValue,
    }) as unknown as WebAudioJsAudioParamImplementation
    const parameter = new api.AudioParam(audioContext, parameterImplementation) as unknown as AudioParam
    parameters.set(descriptor.name, parameter)
    parameterImplementations.set(descriptor.name, parameterImplementation)
  }

  Object.defineProperty(node, 'parameters', { value: parameters })

  let active = true
  node.onaudioprocess = (event) => {
    if (!active) return

    const inputs = [getChannelData(event.inputBuffer)]
    const outputs = [getChannelData(event.outputBuffer)]
    const parameterValues: Record<string, Float32Array> = {}

    for (const descriptor of parameterDescriptors) {
      const parameter = parameterImplementations.get(descriptor.name)!
      parameter.dspProcess()
      parameterValues[descriptor.name] =
        descriptor.automationRate != 'k-rate' && parameter.hasSampleAccurateValues()
          ? parameter.getSampleAccurateValues()
          : Float32Array.of(parameter.getValue())
    }

    active = processor.process(inputs, outputs, parameterValues)
  }

  return node as AudioWorkletProcessorScriptNode
}

function getChannelData(buffer: AudioBuffer): Float32Array[] {
  return Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel))
}
