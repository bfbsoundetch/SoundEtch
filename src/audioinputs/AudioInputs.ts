import { RemoteMediaClient3 } from 'remote/RemoteMediaClient3'
import { AudioControl, AudioState } from '../audiocontext/AudioControl'
import { Logger } from '../global/Logger'
import { LocalMediaStreams } from '../mediastreams/LocalMediaStreams'
import { AudioInput } from './AudioInput'
import { MediaStreamInput as MediaStreamInput } from './MediaStreamInput'

const logger = new Logger('AudioInputs')

export class AudioInputs {
  private static listeners = new Array<() => any>()
  static generators = new Array<AudioInput>()
  static localAVDevice: MediaStreamInput = new MediaStreamInput('local-mic', 'local microphone', false)
  static localScreenShare = new MediaStreamInput('local-screen', 'local screen', false)
  private static remoteStreams = new Map<string, MediaStreamInput>()
  private static remoteScreenShare: MediaStreamInput | null = null

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
    if (this.remoteScreenShare) {
      result.push(this.remoteScreenShare)
    }
    result.push(...this.generators)
    result.push(...this.remoteStreams.values())
    return result
  }

  static getRemoteStreamForUser(id: string, isScreenShare: boolean) {
    return this.remoteStreams.get(id)
  }

  static getRemoteInputs() {
    return [...this.remoteStreams.values()]
  }

  static registerRemoteMediaClient(remoteMediaClient: RemoteMediaClient3) {
    remoteMediaClient.addStateListener((state) => {
      if (state.screenShare && state.screenShare != 'self') {
        this.remoteScreenShare = new MediaStreamInput(
          `${state.screenShare.peerId}-screen`,
          state.screenShare.username,
          false,
        )
      } else {
        this.remoteScreenShare?.stop()
        this.remoteScreenShare = null
      }
      const ourMembers = new Set(this.remoteStreams.keys())
      for (const member of state.members) {
        if (ourMembers.has(member.peerId)) {
          ourMembers.delete(member.peerId)
          continue
        }
        member.mediaStream.addEventListener('addtrack', (trackEvent) => {
          if (trackEvent.track.kind == 'audio') {
            let input = this.remoteStreams.get(member.peerId)
            if (!input) {
              input = new MediaStreamInput(member.peerId, member.username, false)
              this.remoteStreams.set(member.peerId, input)
            }
            input.updateMediaStreamTrack(trackEvent.track)
          }
        })
        member.mediaStream.addEventListener('removetrack', (trackEvent) => {
          logger.debug(`Member ${member.peerId} removed a ${trackEvent.track.kind} track`)
          if (trackEvent.track.kind == 'audio') {
            this.remoteStreams.get(member.peerId)?.stop()
          }
        })
      }
      ourMembers.forEach((id) => {
        this.remoteStreams.get(id)?.stop()
        this.remoteStreams.delete(id)
      })

      AudioInputs.notifyListeners()
    })
  }
}
