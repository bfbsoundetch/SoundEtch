// to be merged with the emscripted-generated module via extern-post-js
// * That means you need to build the wasm again if you modify this. *
export class PeakFindingProcessor extends AudioWorkletProcessor {
  static RENDER_QUANTUM_SIZE = 128

  constructor(options) {
    super(options)
    createModule().then((Module) => {
      const channelCount = options.channelCount ?? 1
      Module._init(
        channelCount,
        options.processorOptions?.updateSampleCount ?? Math.round((100 * sampleRate) / 1000), //100ms
        options.processorOptions?.holdSampleCount ?? Math.round(1.5 * sampleRate), //1.5s,
        PeakFindingProcessor.RENDER_QUANTUM_SIZE,
      )
      const instantaneousPeaksPointer = Module._getInstantaneousPeaks()
      this.instantaneousPeaks = Module.HEAPF32.subarray(
        instantaneousPeaksPointer / Float32Array.BYTES_PER_ELEMENT,
        instantaneousPeaksPointer / Float32Array.BYTES_PER_ELEMENT + channelCount,
      )
      const heldPeaksPointer = Module._getHeldPeaks()
      this.heldPeaks = Module.HEAPF32.subarray(
        heldPeaksPointer / Float32Array.BYTES_PER_ELEMENT,
        heldPeaksPointer / Float32Array.BYTES_PER_ELEMENT + channelCount,
      )
      const wasmInputPointer = Module._getInputArray()
      this.wasmInput = Module.HEAPF32.subarray(
        wasmInputPointer / Float32Array.BYTES_PER_ELEMENT,
        wasmInputPointer / Float32Array.BYTES_PER_ELEMENT + PeakFindingProcessor.RENDER_QUANTUM_SIZE * channelCount,
      )
      this.Module = Module
      this.port.postMessage({
        instantaneousPeaks: this.instantaneousPeaks,
        heldPeaks: this.heldPeaks,
      })
    })
  }

  process([inputs], [outputs]) {
    if (!!this.wasmInput && !!inputs[0]) {
      for (let i = 0; i < PeakFindingProcessor.RENDER_QUANTUM_SIZE; ++i) {
        for (let channel = 0; channel < inputs.length; ++channel) {
          this.wasmInput[i * inputs.length + channel] = inputs[channel][i]
          outputs[channel][i] = inputs[channel][i]
        }
      }
      this.Module._lanczosInterpolatedPeak()
    }
    return true
  }
}

registerProcessor('PeakFindingProcessor', PeakFindingProcessor)
