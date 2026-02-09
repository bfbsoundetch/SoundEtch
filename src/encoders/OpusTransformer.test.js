import createModule from './wasm/opus/opus_encoder'
import { FileSystemUtils } from '../filesystem/FileSystemUtils'

// if you make this TS, jest tries to transform it,
// which means --experimental-vm-modules doesn't work!
// If you don't use the --SINGLE_FILE=1 flag in emcc,
// node fails trying to fetch!!

const inputBufferSize = 48000 * 0.06

test('convert', async () => {
  const { promise, resolve, reject } = Promise.withResolvers()

  const fileHandle = await (await FileSystemUtils.getFileHandle('.', 'test.opus')).createSyncAccessHandle()

  const c = await createModule()
  let totalOutputBytes = 0
  globalThis.opusEncoderWriteCallback = function (userDataPointer, bufferPointer, length) {
    fileHandle.write(c.HEAP8.subarray(bufferPointer, bufferPointer + length), {
      at: totalOutputBytes,
    })
    totalOutputBytes += length
  }
  globalThis.opusEncoderCloseCallback = function () {
    console.error('clothed')
    fileHandle.close()
    resolve()
  }

  console.error(Object.keys(c))
  const opusEncoderPointer = c._create_encoder(48000, 1, 64000, '', 10, '', 'audio')
  const inputBufferPointer = c._malloc(inputBufferSize * Float32Array.BYTES_PER_ELEMENT)

  const inputBuffer = c.HEAPF32.subarray(
    inputBufferPointer / Float32Array.BYTES_PER_ELEMENT,
    inputBufferPointer / Float32Array.BYTES_PER_ELEMENT + inputBufferSize,
  )
  console.error('oep ' + opusEncoderPointer)
  const outputBufferPointer = c._malloc(16 * 1024)
  const outputBuffer = c.HEAP8.subarray(outputBufferPointer, outputBufferPointer + 16 * 1024)

  for (let n = 0; n < 10; ++n) {
    fillBuffer(inputBuffer, n)
    const outputLength = c._encode_frame(opusEncoderPointer, inputBufferPointer, inputBuffer.length)
    console.error('ol ' + outputLength)
    fileHandle.write(outputBuffer.subarray(0, outputLength), {
      at: totalOutputBytes,
    })
    totalOutputBytes += outputLength
  }

  console.error(c._finalize_encoding(opusEncoderPointer))

  await promise
}, 10000)

function fillBuffer(inputBuffer, n) {
  for (let i = 0; i < inputBuffer.length; ++i) {
    const angle = (440 * (i + n * inputBuffer.length) * (Math.PI * 2)) / 48000
    inputBuffer[i] = Math.sin(angle) * 0.8
  }
}
