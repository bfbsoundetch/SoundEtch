import { FileSystemUtils } from '../filesystem/FileSystemUtils'

// this is also an AudioContext-controlled worker!!
async function onInitializeEncoder(e) {
  const bitsPerSample = e.data.bitsPerSample
  const sampleRate = e.data.sampleRate
  globalThis.channelCount = e.data.channelCount
  const compressionLevel = e.data.compressionLevel
  const metadata = e.data.metadata
  globalThis.outputFile = await (
    await FileSystemUtils.getFileHandle(e.data.dirName, e.data.fileName)
  ).createSyncAccessHandle()

  globalThis.position = 0
  globalThis.samplesWritten = 0
  globalThis.totalSamples = e.data.totalSamples

  if (channelCount < 1 || channelCount > 8) {
    throw new Error('Channel count must be between 1 and 8, but was ' + channelCount)
  }
  if (compressionLevel < 0 || compressionLevel > 8) {
    throw new Error('Compression level must be between 0 and 8, but was ' + compressionLevel)
  }
  if (bitsPerSample < 4 || bitsPerSample > 32) {
    throw new Error('Bits per sample must be between 4 and 32, but was ' + bitsPerSample)
  }
  if (sampleRate < 1 || sampleRate > 655350) {
    throw new Error('Sample rate must be between 1 and 655350, but was ' + sampleRate)
  }

  // hack to prevent Vite from processing Emscripten-generated file
  // why doesn't vite-ignore work?
  globalThis.Module = await (await import(new URL('./wasm/flac_encoder.mjs', import.meta.url))).createModule()
  globalThis.inputBufferLength = 1 << 16
  globalThis.inputBufferPointer = Module._malloc(inputBufferLength * Int32Array.BYTES_PER_ELEMENT)
  Module._create_encoder(bitsPerSample, sampleRate, globalThis.channelCount, compressionLevel)
  globalThis.inputBuffer = new Int32Array(
    Module.HEAP8.subarray(inputBufferPointer, inputBufferPointer + inputBufferLength),
  )
  if (!(Module.HEAP8.buffer instanceof SharedArrayBuffer)) {
    throw new Error("WASM memory isn't shared. Do you need pthreads=1?")
  }
  postMessage({
    inputBuffer: Module.HEAP8.buffer,
    pointer: inputBufferPointer,
    length: inputBufferLength,
  })
}

function onReceiveChunk(e) {
  Module._encode_chunk(inputBufferPointer, Math.floor(e.data.length / channelCount))
  postMessage({ samplesWritten: globalThis.samplesWritten })
}

async function onInputFinished(e) {
  await Module._finish_encoding()
  globalThis.outputFile.close()
  postMessage({ finished: true })
}

self.onmessage = async (e) => {
  switch (e.data.type) {
    case 'init':
      await onInitializeEncoder(e)
      break
    case 'data':
      onReceiveChunk(e)
      break
    case 'inputFinished':
      onInputFinished(e)
      break
    default:
      throw new Error('Unrecognized message type: ' + e.data.type)
  }
}

self.onerror = (e) => {
  console.error('FLAC Worker onerror ' + e)
}

self.onmessageerror = (e) => {
  console.error('FLAC Worker onmessageerror ' + e)
}
