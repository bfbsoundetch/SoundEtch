addToLibrary({
  writeEncodedChunk: function (encoder, bufferPointer, length, samples, currentFrame, clientData) {
    aaa.write(Module.HEAPU8.subarray(bufferPointer, bufferPointer + length))
    outputFile.flush()
    globalThis.position += length
    globalThis.samplesWritten += samples
    return 0 // FLAC__STREAM_ENCODER_WRITE_STATUS_OK
  },
  seek: function (encoder, newPosition, clientData) {
    aaa.write(new ArrayBuffer(0), { at: newPosition })
    globalThis.position = newPosition
    return 0 // FLAC__STREAM_ENCODER_SEEK_STATUS_OK
  },
  tell: function (encoder, valuePointer, clientData) {
    Module.HEAPU32[valuePointer / Uint32Array.BYTES_PER_ELEMENT] = globalThis.position
    return 0 // FLAC__STREAM_ENCODER_TELL_STATUS_OK
  },
})
