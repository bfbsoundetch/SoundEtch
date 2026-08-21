import { RawDataAudioContext } from '@descript/web-audio-js'
import {
  AudioWorkletParameterDescriptor,
  AudioWorkletProcessorImplementation,
  createAudioWorkletProcessorScriptNode,
} from './AudioWorkletProcessorScriptNode'

class TestProcessor implements AudioWorkletProcessorImplementation {
  static readonly parameterDescriptors: AudioWorkletParameterDescriptor[] = [
    { name: 'gain', defaultValue: 1, minValue: 0, maxValue: 2, automationRate: 'a-rate' },
    { name: 'mode', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
  ]

  static lastParameters: Record<string, Float32Array> | null = null

  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>) {
    TestProcessor.lastParameters = parameters
    outputs[0][0].set(inputs[0][0])
    return true
  }
}

test('adapts AudioWorkletProcessor parameters to web-audio-js', () => {
  const audioContext = new RawDataAudioContext({ sampleRate: 48000, blockSize: 128, numberOfChannels: 1 })
  const context = audioContext as unknown as BaseAudioContext
  const node = createAudioWorkletProcessorScriptNode(context, TestProcessor)
  const source = context.createConstantSource()
  source.connect(node)
  source.start()
  node.connect(context.destination)
  node.parameters.get('gain')!.setValueAtTime(0, 0)
  node.parameters.get('gain')!.linearRampToValueAtTime(1, 128 / audioContext.sampleRate)
  node.parameters.get('mode')!.setValueAtTime(1, 0)
  audioContext.resume()

  audioContext.process([new Float32Array(128)])

  expect(TestProcessor.lastParameters!.gain).toHaveLength(128)
  expect(TestProcessor.lastParameters!.gain[0]).toBeCloseTo(0)
  expect(TestProcessor.lastParameters!.gain[127]).toBeCloseTo(127 / 128)
  expect(TestProcessor.lastParameters!.mode).toEqual(Float32Array.of(1))
})
