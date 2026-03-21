type Listener = (added: boolean, track: MediaStreamTrack) => any

export class LocalMediaStreams {
  private static avDeviceChangeListeners = new Array<Listener>()
  private static screenChangeListeners = new Array<Listener>()

  static readonly localScreenMediaStream = new MediaStream()
  static readonly localAVDeviceMediaStream = new MediaStream()

  static async startAudioDevice(): Promise<MediaStream> {
    if (LocalMediaStreams.localAVDeviceMediaStream.getAudioTracks().length > 0) {
      return Promise.resolve(LocalMediaStreams.localAVDeviceMediaStream)
    }
    if (!navigator.mediaDevices.getUserMedia) {
      throw Error('Device recording not supported by the browser.')
    }
    const mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
    })
    mediaStream.getAudioTracks().forEach((track) => {
      track.onended = (_) => {
        LocalMediaStreams.localAVDeviceMediaStream.removeTrack(track)
        LocalMediaStreams.updateAVDeviceListeners(false, track)
      }
      LocalMediaStreams.localAVDeviceMediaStream.addTrack(track)
      LocalMediaStreams.updateAVDeviceListeners(true, track)
    })
    return mediaStream
  }

  static async startVideoDevice(
    aspectRatio: number = 1.5,
    width: number | null = null,
    frameRate: number | null = null,
    facingEnvironment: boolean = false,
  ): Promise<MediaStream> {
    if (!navigator.mediaDevices.getUserMedia) {
      throw Error('Device recording not supported by the browser.')
    }
    const constraints: MediaTrackConstraints = {
      aspectRatio: aspectRatio,
      facingMode: facingEnvironment ? 'environment' : 'user',
    }
    if (width) {
      constraints.width = width
      constraints.height = Math.round(width * aspectRatio)
    }
    if (frameRate) {
      constraints.frameRate = frameRate
    }
    const mediaStream = await navigator.mediaDevices.getUserMedia({
      video: constraints,
    })
    mediaStream.getVideoTracks().forEach((track) => {
      track.onended = (_) => {
        LocalMediaStreams.localAVDeviceMediaStream.removeTrack(track)
        LocalMediaStreams.updateAVDeviceListeners(false, track)
      }
      LocalMediaStreams.localAVDeviceMediaStream.addTrack(track)
      LocalMediaStreams.updateAVDeviceListeners(true, track)
    })
    return mediaStream
  }

  static async startCapturingTab(): Promise<MediaStream> {
    if (LocalMediaStreams.localScreenMediaStream.getTracks().length > 0) {
      return Promise.resolve(this.localScreenMediaStream)
    }
    if (!navigator.mediaDevices.getDisplayMedia) {
      throw Error('Screen recording not supported by the browser.')
    }
    console.error(
      'Supported media device constraints: ' + JSON.stringify(navigator.mediaDevices.getSupportedConstraints()),
    )
    const mediaStream = await navigator.mediaDevices.getDisplayMedia({
      audio: {
        noiseSuppression: false,
        echoCancellation: false,
        channelCount: 2,
        autoGainControl: false,
        sampleSize: 32,
      },
    })
    // The video stream needs to stay open the entire time it's capturing audio.
    mediaStream.getTracks().forEach((track) => {
      track.onended = (_) => {
        LocalMediaStreams.localScreenMediaStream.removeTrack(track)
        LocalMediaStreams.updateScreenListeners(false, track)
      }
      LocalMediaStreams.localScreenMediaStream.addTrack(track)
      LocalMediaStreams.updateScreenListeners(true, track)
    })
    return mediaStream
  }

  static endVideoDeviceStream() {
    LocalMediaStreams.localAVDeviceMediaStream.getVideoTracks().forEach((track) => {
      track.stop()
      LocalMediaStreams.localAVDeviceMediaStream.removeTrack(track)
      LocalMediaStreams.updateAVDeviceListeners(false, track)
      console.error('oko' + LocalMediaStreams.localAVDeviceMediaStream.getVideoTracks().length)
    })
  }

  static endAudioDeviceStream() {
    LocalMediaStreams.localAVDeviceMediaStream.getAudioTracks().forEach((track) => {
      track.stop()
      LocalMediaStreams.localAVDeviceMediaStream.removeTrack(track)
      LocalMediaStreams.updateAVDeviceListeners(false, track)
    })
  }

  static endScreenShare() {
    LocalMediaStreams.localScreenMediaStream.getTracks().forEach((track) => {
      track.stop()
      LocalMediaStreams.localScreenMediaStream.removeTrack(track)
      LocalMediaStreams.updateScreenListeners(false, track)
    })
  }

  static registerAVDeviceListener(listener: Listener) {
    LocalMediaStreams.avDeviceChangeListeners.push(listener)
    LocalMediaStreams.localAVDeviceMediaStream.getTracks().forEach((t) => listener(true, t))
  }

  private static updateAVDeviceListeners(added: boolean, track: MediaStreamTrack) {
    LocalMediaStreams.avDeviceChangeListeners.forEach((listener) => listener(added, track))
  }

  static registerScreenListener(listener: Listener) {
    LocalMediaStreams.screenChangeListeners.push(listener)
    if (LocalMediaStreams.localScreenMediaStream) {
      // Screen share is video+audio or video-only
      LocalMediaStreams.localScreenMediaStream.getTracks().forEach((t) => listener(true, t))
    } else {
      listener(false, new MediaStreamTrack())
    }
  }

  private static updateScreenListeners(added: boolean, track: MediaStreamTrack) {
    LocalMediaStreams.screenChangeListeners.forEach((listener) => listener(added, track))
  }
}
