import { LocalMediaStreams } from '../mediastreams/LocalMediaStreams'
import { AudioInput } from './AudioInput'
import { MediaStreamInput as MediaStreamInput } from './MediaStreamInput'

export class AudioInputs {
  private static listeners = new Array<() => any>()
  static generators = new Array<AudioInput>()
  static localAVDevice: MediaStreamInput | null = null
  static localScreenShare: AudioInput | null = null
  static remoteStreams = new Map<{ username: string; isScreenShare: boolean }, AudioInput>()

  static {
    LocalMediaStreams.registerAVDeviceListener((added, track) => {
      if (track.kind != 'audio') {
        return
      }
      if (added) {
        AudioInputs.localAVDevice = new MediaStreamInput('local-mic', track, true)
      } else {
        AudioInputs.localAVDevice = null
      }
      AudioInputs.notifyListeners()
    })
    LocalMediaStreams.registerScreenListener((added, track) => {
      if (track.kind != 'audio') {
        return
      }
      if (added) {
        AudioInputs.localScreenShare = new MediaStreamInput('local-screen', track, false)
      } else {
        AudioInputs.localScreenShare = null
      }
      AudioInputs.notifyListeners()
    })
  }

  static addListener(listener: () => any) {
    AudioInputs.listeners.push(listener)
  }

  private static notifyListeners() {
    AudioInputs.listeners.forEach((listener) => listener())
  }

  static gatherActiveAudioInputs(): Array<AudioInput> {
    const result = new Array<AudioInput>()
    if (this.localAVDevice) {
      result.push(this.localAVDevice)
    }
    if (this.localScreenShare) {
      result.push(this.localScreenShare)
    }
    result.push(...this.generators)
    result.push(...this.remoteStreams.values())
    return result
  }

  static async maybeAddRemoteAudioSource(
    username: string,
    isScreenShare: boolean,
    remoteMediaStreamTrack: MediaStreamTrack,
  ) {
    AudioInputs.remoteStreams.set(
      { username: username, isScreenShare: isScreenShare },
      new MediaStreamInput(
        `${username.replaceAll(' ', '.')}-${isScreenShare ? 'screen' : ''}`,
        remoteMediaStreamTrack,
        false,
      ),
    )
    AudioInputs.notifyListeners()
  }

  static removeRemoteAudioSource(username: string, isScreenShare: boolean) {
    AudioInputs.remoteStreams.delete({
      username: username,
      isScreenShare: isScreenShare,
    })
    AudioInputs.notifyListeners()
  }
}
