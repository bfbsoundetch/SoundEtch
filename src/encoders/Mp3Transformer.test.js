import createModule from './wasm/mp3/mp3_encoder'
import { FileSystemUtils } from '../filesystem/FileSystemUtils'

// if you make this TS, jest tries to transform it,
// which means --experimental-vm-modules doesn't work!
// If you don't use the --SINGLE_FILE=1 flag in emcc,
// node fails trying to fetch!!

const inputBufferSize = 4 * 1024

test('convert', async () => {
  const fileHandle = await (await FileSystemUtils.getFileHandle('.', 'test.mp3')).createSyncAccessHandle()

  const c = await createModule()
  console.error(Object.keys(c))
  const lamePointer = c._init_lame(1, 48000, 64000)
  const inputBufferPointer = c._malloc(inputBufferSize * Float32Array.BYTES_PER_ELEMENT)

  const inputBuffer = c.HEAPF32.subarray(
    inputBufferPointer / Float32Array.BYTES_PER_ELEMENT,
    inputBufferPointer / Float32Array.BYTES_PER_ELEMENT + inputBufferSize,
  )
  console.error(inputBuffer.length)
  const outputBufferPointer = c._malloc(16 * 1024)
  const outputBuffer = c.HEAP8.subarray(outputBufferPointer, outputBufferPointer + 16 * 1024)

  var totalOutputBytes = 0
  for (let n = 0; n < 2; ++n) {
    fillBuffer(inputBuffer, n)
    const outputLength = c._encode_samples(
      lamePointer,
      inputBufferPointer,
      inputBufferPointer,
      inputBufferSize,
      outputBufferPointer,
      16 * 1024,
    )
    fileHandle.write(outputBuffer.subarray(0, outputLength), {
      at: totalOutputBytes,
    })
    totalOutputBytes += outputLength
  }

  const finalOutputBytes = c._flush_lame(lamePointer, outputBufferPointer, 16 * 1024)
  fileHandle.write(outputBuffer.subarray(0, finalOutputBytes), {
    at: totalOutputBytes,
  })
  totalOutputBytes += finalOutputBytes

  const lameHeaderLength = c._get_lame_tag(lamePointer, outputBufferPointer, 16 * 1024)
  console.error('lhl ' + lameHeaderLength)
  fileHandle.write(outputBuffer.subarray(0, lameHeaderLength), { at: 0 })

  c._close_lame(lamePointer)
}, 10000)

function fillBuffer(inputBuffer, n) {
  for (let i = 0; i < inputBuffer.length; ++i) {
    const angle = (440 * (i + n * inputBuffer.length) * (Math.PI * 2)) / 48000
    inputBuffer[i] = Math.sin(angle) * 0.8
  }
}
