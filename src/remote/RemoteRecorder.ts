export class RemoteRecorder {
  private readonly mediaRecorder: MediaRecorder

  constructor(mediaStream: MediaStream, emit: (_: ArrayBuffer) => void) {
    this.mediaRecorder = new MediaRecorder(mediaStream, { mimeType: 'audio/webm;codecs=pcm' })
    this.mediaRecorder.addEventListener('dataavailable', async (e) => {
      emit(await e.data.arrayBuffer())
    })
  }

  start() {
    this.mediaRecorder.start(/* timeslice= */ 1000)
  }

  stop() {
    this.mediaRecorder.stop()
  }
}
