import {} from '../tests/StubAudio.js'
import { PeakFindingProcessor } from './PeakFindingProcessor.js'
import createModule from './wasm/upsampled_peak.mjs'

global.createModule = createModule

test('simple2', async () => {
  const outputArray = new Array(128).fill(0)
  const testArray = new Array(128).fill(0)
  const testData = [-1, -1, 1, 1, -1, -1, 1, 1, -1, -1, 1, 1, -1, -1, 1, 1, -1, -1, 1, 1]
  testData.forEach((n, i) => (testArray[i] = n))
  const processor = new PeakFindingProcessor({
    processorOptions: { updateSampleCount: 15 },
  })
  let { promise, resolve, reject } = Promise.withResolvers()
  processor.onmessage = (message) => {
    resolve(message.peak)
  }
  const peak = await promise
  processor.process([[testArray]], [[outputArray]])
  console.log(peak[0])
})
