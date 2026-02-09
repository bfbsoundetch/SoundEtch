import Worker from 'web-worker'

test('convert', async () => {
  const totalSamples = 1024 * 1024
  const flacWorker = new Worker('./dist/assets/flacEncodingWorker.js', {
    type: 'module',
  })

  let inputSamples = 0
  let { promise, resolve, reject } = Promise.withResolvers()
  flacWorker.addEventListener('exit', async (e) => {
    console.log('Exit event ' + e)
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
    for (; i < inputBuffer.length && inputSamples < totalSamples; ++i) {
      const angle = (440 * inputSamples++ * (Math.PI * 2)) / 48000
      inputBuffer[i] = Math.floor(Math.sin(angle) * 32787 * 0.8)
    }
    flacWorker.postMessage({
      type: 'data',
      length: i,
    })
  }
  flacWorker.addEventListener('message', async (e) => {
    if (!!e.data.inputBuffer) {
      debugger
      inputBuffer = new Int32Array(e.data.inputBuffer, e.data.pointer, e.data.length)
      sendAudioData()
    } else if (!!e.data.samplesWritten) {
      sendAudioData()
    } else if (!!e.data.finished) {
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
    fileName: 'test.flac',
    dirName: '.',
  })

  await promise
  flacWorker.terminate()
}, 10000)
