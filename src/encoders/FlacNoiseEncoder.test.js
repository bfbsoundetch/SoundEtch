import Worker from 'web-worker'
import {} from '../audioinputs/generators/StubAudio'
import { WasmNoiseGeneratingProcessor } from '../audioinputs/generators/WasmNoiseGeneratingProcessor'

async function waitForProcessorReady(processor) {
  let { promise, resolve, reject } = Promise.withResolvers()
  processor.onmessage = (message) => {
    console.log(message)
    if (message === 'loaded') {
      resolve()
    }
  }
  await promise
}

test('convert', async () => {
  const processor = new WasmNoiseGeneratingProcessor({
    processorOptions: { alpha: -2, amplitude: 0.5 },
  })
  await waitForProcessorReady(processor)

  const totalSamples = 1024 * 1024
  const flacWorker = new Worker('./src/encoders/FlacEncoderWorker.js', {
    type: 'module',
  })

  let inputSamples = 0
  let { promise, resolve, reject } = Promise.withResolvers()
  flacWorker.addEventListener('exit', async (e) => {
    console.log('Exit event ' + JSON.stringify(e))
  })
  flacWorker.addEventListener('error', async (e) => {
    console.log('Error event ' + e)
  })

  let inputBuffer
  const sendAudioData = () => {
    if (inputSamples >= totalSamples) {
      flacWorker.postMessage({ type: 'inputFinished' })
      return
    }
    let i = 0
    const noiseOutput = new Array(128)
    while (i < inputBuffer.length) {
      processor.process(null, [[noiseOutput]], null)
      for (let j = 0; j < noiseOutput.length; ++j) {
        inputBuffer[i++] = Math.floor(noiseOutput[j] * (1 << 15))
      }
      inputSamples += noiseOutput.length
    }
    flacWorker.postMessage({
      type: 'data',
      length: i,
    })
  }
  flacWorker.addEventListener('message', async (e) => {
    if (e.data.inputBuffer !== undefined) {
      inputBuffer = new Int32Array(e.data.inputBuffer, e.data.pointer, e.data.length)
      sendAudioData()
    } else if (e.data.samplesWritten !== undefined) {
      sendAudioData()
    } else if (e.data.finished !== undefined) {
      resolve()
    }
  })

  flacWorker.postMessage({
    type: 'init',
    bitsPerSample: 16,
    sampleRate: 48000,
    channelCount: 1,
    compressionLevel: 5,
    totalSamples: totalSamples,
  })

  await promise
  flacWorker.terminate()
}, 30000)
