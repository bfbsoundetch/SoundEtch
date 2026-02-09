import createModule from './wasm/flac/flac_encoder'
import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import { expect, test } from 'vitest'

// if you make this TS, jest tries to transform it,
// which means --experimental-vm-modules doesn't work!
// If you don't use the --SINGLE_FILE=1 flag in emcc,
// node fails trying to fetch!!

const inputBufferSize = 48000 * 0.06

test('convert', async () => {
  const { promise, resolve } = Promise.withResolvers()

  const fileHandle = await (await FileSystemUtils.getFileHandle('.', 'test.flac')).createWritable()

  const c = await createModule()

  let fileWritePosition = 0
  const inputBufferSize = 32 * 1024
  const channelCount = 2
  const inputBufferPointer = c._get_input_buffer_pointer(channelCount, inputBufferSize)
  const inputBuffers = []
  for (let channel = 0; channel < channelCount; ++channel) {
    const start = inputBufferPointer / Int32Array.BYTES_PER_ELEMENT + channel * inputBufferSize
    inputBuffers.push(c.HEAP32.subarray(start, start + inputBufferSize))
  }

  let frames = 0
  const underlyingSource = {
    cancel: (reason) => {},
    pull: (controller) => {
      if (frames >= 10) {
        console.error(c._get_encoder_state())
        c._finish_encoding()
        controller.close()
        return
      }
      fillBuffer(inputBuffers[0], frames)
      fillBuffer(inputBuffers[1], frames + 1)
      c._encode_chunk(inputBuffers[0].length)
      ++frames
    },
    start: (controller) => {
      globalThis.flacEncoderWriteCallback = function (bufferPointer, length, samples) {
        if (samples == 0) {
          console.error('zeroed ' + fileWritePosition + ' ' + length)
        }
        controller.enqueue(c.HEAP8.slice(bufferPointer, bufferPointer + length))
        fileWritePosition += length
        return 0 // FLAC__STREAM_ENCODER_WRITE_STATUS_OK
      }
      c._create_encoder(24, 48000, channelCount, 10)
    },
    type: 'bytes',
  }

  // globalThis.flacEncoderWriteCallback = function(
  //   bufferPointer,
  //   length,
  //   samples,
  // ) {
  //   fileHandle.write(c.HEAP8.slice(bufferPointer, bufferPointer + length))
  //   fileWritePosition += length

  //   console.error('written ' + length)
  //   return 0 // FLAC__STREAM_ENCODER_WRITE_STATUS_OK
  // }
  globalThis.flacEncoderSeekCallback = function (newPosition) {
    fileHandle.seek(newPosition)
    console.error('seeked from ' + fileWritePosition + ' to ' + newPosition)
    fileWritePosition = newPosition
    return 0 // FLAC__STREAM_ENCODER_SEEK_STATUS_OK
  }
  globalThis.flacEncoderTellCallback = function (valuePointer) {
    c.HEAPU32[valuePointer / Uint32Array.BYTES_PER_ELEMENT] = fileWritePosition
    return 0 // FLAC__STREAM_ENCODER_TELL_STATUS_OK
  }

  await new ReadableStream(underlyingSource).pipeTo(fileHandle)

  console.error(Object.keys(c))

  // for (let n = 0; n < 10; ++n) {
  //   fillBuffer(inputBuffers[0], n)
  //   fillBuffer(inputBuffers[1], n + 1)
  //   c._encode_chunk(
  //     inputBuffers[0].length,
  //   )
  // }

  // console.error(c._get_encoder_state())
  // c._finish_encoding()

  console.error('really done')
}, 10000)

function fillBuffer(inputBuffer, n) {
  for (let i = 0; i < inputBuffer.length; ++i) {
    const angle = (440 * (i + n * inputBuffer.length) * (Math.PI * 2)) / 48000
    inputBuffer[i] = Math.sin(angle) * 0.8 * ((1 << 23) - 1)
  }
}
