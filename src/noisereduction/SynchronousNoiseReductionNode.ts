import { DeepFilter } from './DeepFilter'
import type { DeepFilterParameters } from './DeepFilterParameters'

export async function createSynchronousNoiseReductionNode(
  audioContext: BaseAudioContext,
  parameters: Partial<DeepFilterParameters> = {},
): Promise<{
  node: ScriptProcessorNode
  setParameters: (parameters: DeepFilterParameters) => void
  dispose: () => void
}> {
  const deepFilter = await DeepFilter.create(parameters)
  const node = audioContext.createScriptProcessor(1024, 1, 1)
  let inputFrame = deepFilter.getInputBuffer()
  let inputLength = 0
  let outputQueue = new Float32Array(deepFilter.frameLength * 4)
  let outputReadPosition = 0
  let outputWritePosition = deepFilter.frameLength

  node.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0)
    const output = event.outputBuffer.getChannelData(0)
    ensureOutputCapacity(input.length + deepFilter.frameLength)
    inputFrame = deepFilter.getInputBuffer()

    for (const sample of input) {
      inputFrame[inputLength++] = sample
      if (inputLength == inputFrame.length) {
        deepFilter.process()
        const outputFrame = deepFilter.getOutputBuffer()
        outputQueue.set(outputFrame, outputWritePosition)
        outputWritePosition += outputFrame.length
        inputFrame = deepFilter.getInputBuffer()
        inputLength = 0
      }
    }

    const available = Math.min(output.length, outputWritePosition - outputReadPosition)
    output.set(outputQueue.subarray(outputReadPosition, outputReadPosition + available))
    output.fill(0, available)
    outputReadPosition += available
  }

  return {
    node,
    setParameters: (values: DeepFilterParameters) => deepFilter.setParameters(values),
    dispose: () => {
      node.onaudioprocess = null
      node.disconnect()
      deepFilter.dispose()
    },
  }

  function ensureOutputCapacity(additionalLength: number) {
    if (outputReadPosition > 0) {
      outputQueue.copyWithin(0, outputReadPosition, outputWritePosition)
      outputWritePosition -= outputReadPosition
      outputReadPosition = 0
    }
    if (outputWritePosition + additionalLength <= outputQueue.length) {
      return
    }
    const expanded = new Float32Array(outputWritePosition + additionalLength)
    expanded.set(outputQueue.subarray(0, outputWritePosition))
    outputQueue = expanded
  }
}
