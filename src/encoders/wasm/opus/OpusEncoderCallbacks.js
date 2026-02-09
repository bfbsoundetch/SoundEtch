addToLibrary({
  write_callback: function (userDataPointer, bufferPointer, length) {
    opusEncoderWriteCallback?.(userDataPointer, bufferPointer, length)
  },
  close_callback: function () {
    opusEncoderCloseCallback?.()
  },
})
