addToLibrary({
  write_callback: function (userDataPointer, bufferPointer, length) {
    return opusEncoderWriteCallback?.(userDataPointer, bufferPointer, length) ?? 0
  },
  close_callback: function (userDataPointer) {
    return opusEncoderCloseCallback?.(userDataPointer) ?? 0
  },
})
