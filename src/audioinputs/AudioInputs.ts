import { AudioControl, AudioState } from '../audiocontext/AudioControl'
import { LocalMediaStreams } from '../mediastreams/LocalMediaStreams'
import { AudioInput } from './AudioInput'
import { MediaStreamInput as MediaStreamInput } from './MediaStreamInput'

export class AudioInputs {
  private static listeners = new Array<() => any>()
  static generators = new Array<AudioInput>()
  static localAVDevice: MediaStreamInput = new MediaStreamInput('local-mic', 'local microphone', false)
  static localScreenShare = new MediaStreamInput('local-screen', 'local screen', false)
  private static remoteStreams = new Map<string, MediaStreamInput>()

  static {
    LocalMediaStreams.registerAVDeviceListener((added, track) => {
      if (track.kind != 'audio') {
        return
      }
      if (added) {
        AudioInputs.localAVDevice.updateMediaStreamTrack(track)
      } else {
        AudioInputs.localAVDevice.stop()
      }
      AudioInputs.notifyListeners()
    })
    LocalMediaStreams.registerScreenListener((added, track) => {
      if (track.kind != 'audio') {
        return
      }
      if (added) {
        AudioInputs.localScreenShare.updateMediaStreamTrack(track)
      } else {
        AudioInputs.localScreenShare.stop()
      }
      AudioInputs.notifyListeners()
    })
    AudioControl.addAudioControlListener(async (state) => {
      const inputs = this.gatherActiveAudioInputs()
      if (inputs.length == 0) {
        return
      }
      const context = await AudioControl.getOrCreateAudioContext()
      if (state == AudioState.MONITORING_PAUSED) {
        context.resume()
      }
      for (const input of inputs) {
        input.init(context)
      }
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
    if (LocalMediaStreams.localAVDeviceMediaStream.getAudioTracks().length > 0) {
      result.push(this.localAVDevice)
    }
    if (LocalMediaStreams.localScreenMediaStream.getAudioTracks().length > 0) {
      result.push(this.localScreenShare)
    }
    result.push(...this.generators)
    result.push(...this.remoteStreams.values())
    return result
  }

  static addRemoteAudioSource(
    username: string,
    isScreenShare: boolean,
  ) {
    const newInput = new MediaStreamInput(
      `${username.replaceAll(' ', '.')}-${isScreenShare ? 'screen' : ''}`,
      username,
      false,
    )
    AudioInputs.remoteStreams.set(`${username}::${isScreenShare}`, newInput)
    AudioInputs.notifyListeners()
    return newInput
  }

  static removeRemoteAudioSource(username: string, isScreenShare: boolean) {
    AudioInputs.remoteStreams.delete(`${username}::${isScreenShare}`)
    AudioInputs.notifyListeners()
  }

  static getRemoteStreamForUser(username: string, isScreenShare: boolean) {
    return this.remoteStreams.get(`${username}::${isScreenShare}`)
  }

  static getRemoteInputs() {
    return [...this.remoteStreams.values()]
  }
}
