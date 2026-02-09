addToLibrary({
  writeEncodedChunk: function (encoder, bufferPointer, length, samples, currentFrame, clientData) {
    if (flacEncoderWriteCallback) {
      return flacEncoderWriteCallback(bufferPointer, length, samples)
    }
    console.warn('flacEncoderWriteCallback not defined')
    return -1
  },
  seek: function (encoder, newPosition, clientData) {
    if (flacEncoderSeekCallback) {
      return flacEncoderSeekCallback(newPosition)
    }
    console.warn('flacEncoderSeekCallback not defined')
    return -1
  },
  tell: function (encoder, valuePointer, clientData) {
    if (flacEncoderTellCallback) {
      return flacEncoderTellCallback(valuePointer)
    }
    console.warn('flacEncoderTellCallback not defined')
    return -1
  },
})
