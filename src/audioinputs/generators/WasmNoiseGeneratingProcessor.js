import createModule from './wasm/noise_generator.mjs'

export class WasmNoiseGeneratingProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options)
    console.log('hi ' + JSON.stringify(options))
    this.alpha = options.processorOptions.alpha
    this.amplitude = options.processorOptions.amplitude
    const scaling = 0.05
    const leakage = 0.997
    console.log('hmmmm')
    createModule().then((Module) => {
      const outputBufferPointer = Module._init(this.alpha, this.amplitude, scaling, leakage, 128)
      this.wasmOut = Module.HEAPF32.subarray(
        outputBufferPointer / Float32Array.BYTES_PER_ELEMENT,
        outputBufferPointer / Float32Array.BYTES_PER_ELEMENT + 128,
      )
      this.Module = Module
      this.port.postMessage('loaded')
    })
  }

  process(inputs, outputs, parameters) {
    if (!!this.wasmOut) {
      this.Module._create_noise()
      for (let i = 0; i < 128; ++i) {
        outputs[0][0][i] = this.wasmOut[i]
      }
    }
    return true
  }
}

registerProcessor('WasmNoiseGeneratingProcessor', WasmNoiseGeneratingProcessor)
