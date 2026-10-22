import { AudioInputs } from '../audioinputs/AudioInputs'
import { LocalMediaStreams } from '../mediastreams/LocalMediaStreams'
import type { RemoteMediaClient3, State } from '../remote/RemoteMediaClient3'

export interface VideoInput {
  /** The id of the audio input from the same person or device, so both record into one linked clip. */
  readonly id: string
  readonly name: string
  readonly track: MediaStreamTrack
  /** Received over a meeting connection rather than captured on this machine. */
  readonly remote: boolean
}

/** Live camera and screen-share video: local devices and what meeting guests send. */
export class VideoInputs {
  private static readonly listeners = new Set<() => void>()
  private static readonly observedStreams = new WeakSet<MediaStream>()
  private static remoteState: State | null = null

  static {
    LocalMediaStreams.registerAVDeviceListener((_, track) => {
      if (track.kind == 'video') VideoInputs.notifyListeners()
    })
    LocalMediaStreams.registerScreenListener((_, track) => {
      if (track.kind == 'video') VideoInputs.notifyListeners()
    })
  }

  static registerRemoteMediaClient(remoteMediaClient: RemoteMediaClient3) {
    remoteMediaClient.addStateListener((state) => {
      VideoInputs.remoteState = state
      for (const member of state.members) VideoInputs.observe(member.mediaStream)
      VideoInputs.notifyListeners()
    })
  }

  static gather(): Array<VideoInput> {
    const result = new Array<VideoInput>()
    const add = (id: string, name: string, stream: MediaStream, remote: boolean) => {
      const track = stream.getVideoTracks().find((videoTrack) => videoTrack.readyState == 'live')
      if (track) result.push({ id, name, track, remote })
    }
    add(AudioInputs.localAVDevice.id, 'local camera', LocalMediaStreams.localAVDeviceMediaStream, false)
    add(
      AudioInputs.localScreenShare.id,
      AudioInputs.localScreenShare.name,
      LocalMediaStreams.localScreenMediaStream,
      false,
    )
    const state = VideoInputs.remoteState
    if (state?.screenShare && state.screenShare != 'self') {
      const { peerId, username, mediaStream } = state.screenShare
      add(AudioInputs.remoteScreenShareId(peerId), AudioInputs.remoteScreenShareName(username), mediaStream, true)
    }
    for (const member of state?.members ?? []) {
      add(member.peerId, member.username, member.mediaStream, true)
    }
    return result
  }

  /** Calls `listener` whenever a video input appears, disappears or changes its track; returns an unsubscriber. */
  static addListener(listener: () => void): () => void {
    VideoInputs.listeners.add(listener)
    return () => VideoInputs.listeners.delete(listener)
  }

  private static observe(stream: MediaStream) {
    if (VideoInputs.observedStreams.has(stream)) return
    VideoInputs.observedStreams.add(stream)
    const onTrackChange = (event: MediaStreamTrackEvent) => {
      if (event.track.kind == 'video') VideoInputs.notifyListeners()
    }
    stream.addEventListener('addtrack', onTrackChange)
    stream.addEventListener('removetrack', onTrackChange)
  }

  private static notifyListeners() {
    VideoInputs.listeners.forEach((listener) => listener())
  }
}
