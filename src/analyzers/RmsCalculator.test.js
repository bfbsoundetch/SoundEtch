import {} from '../tests/StubAudio.js'
import { RmsProcessor } from './RmsProcessor.js'

test('simple', async () => {
  global.sampleRate = 1000
  const output = new Float32Array(1)
  const rmsCalculator = new RmsProcessor({
    processorOptions: {
      output: output,
      rmsWindow: 4,
      windowStep: 1,
    },
  })
  const argument = [[[0]]]
  ;[0, 1, 0, -1, 0, 1, 0, -1, 0, 1, 0, -1].forEach((i) => {
    argument[0][0][0] = i
    rmsCalculator.process(argument)
  })

  console.log(output[0])
})
