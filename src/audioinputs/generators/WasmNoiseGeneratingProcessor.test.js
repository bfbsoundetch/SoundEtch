import {} from '../../tests/StubAudio.js'
import { WasmNoiseGeneratingProcessor } from './WasmNoiseGeneratingProcessor.js'

test('convert', async () => {
  const processor = new WasmNoiseGeneratingProcessor({
    processorOptions: { alpha: 2, amplitude: 0.5 },
  })
  let { promise, resolve, reject } = Promise.withResolvers()
  processor.onmessage = (message) => {
    console.log(message)
    if (message === 'loaded') {
      resolve()
    }
  }
  await promise
  for (let i = 0; i < 1000; ++i) {
    const output = [[new Array(128)]]
    processor.process([[new Array(128)]], output, null)
  }
})
