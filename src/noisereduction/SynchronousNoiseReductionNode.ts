import { DeepFilter } from './DeepFilter'

export async function createSynchronousNoiseReductionNode(audioContext: BaseAudioContext): Promise<AudioNode> {
  const deepFilter = await DeepFilter.create()
  const node = audioContext.createScriptProcessor(1024, 1, 1)
  const inputFrame = deepFilter.getInputBuffer()
  const outputFrame = deepFilter.getOutputBuffer()
  let inputLength = 0
  let outputQueue = new Float32Array(deepFilter.frameLength * 4)
  let outputReadPosition = 0
  let outputWritePosition = deepFilter.frameLength

  node.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0)
    const output = event.outputBuffer.getChannelData(0)
    ensureOutputCapacity(input.length + deepFilter.frameLength)

    for (const sample of input) {
      inputFrame[inputLength++] = sample
      if (inputLength == inputFrame.length) {
        deepFilter.process(inputFrame, outputFrame)
        outputQueue.set(outputFrame, outputWritePosition)
        outputWritePosition += outputFrame.length
        inputLength = 0
      }
    }

    const available = Math.min(output.length, outputWritePosition - outputReadPosition)
    output.set(outputQueue.subarray(outputReadPosition, outputReadPosition + available))
    output.fill(0, available)
    outputReadPosition += available
  }

  return node

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
