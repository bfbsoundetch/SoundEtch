export class MediaStreams {
  static stopMediaStream(mediaStream: MediaStream) {
    for (const track of mediaStream.getTracks()) {
      track.stop()
      track.enabled = false
    }
  }
}
