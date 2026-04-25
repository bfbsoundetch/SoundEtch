import { AudioInputs } from '../audioinputs/AudioInputs'
import { AudioInput } from '../audioinputs/AudioInput'
import { PeakMeterController } from './PeakMeterController'
import { Analyzer } from '../analyzers/Analyzer'
import { AudioControl, AudioState } from '../audiocontext/AudioControl'
import { MediaStreamButtonController } from './MediaStreamButtonController'

export class AudioInputsController {
  private static LOCAL_DEVICE_ELEMENT_ID = 'mic-audio-source'
  private static LOCAL_SCREEN_SHARE_ELEMENT_ID = 'tab-audio-source'

  private readonly peakMeters = new Map<string, PeakMeterController>()

  constructor() {
    new MediaStreamButtonController(document.getElementById('mic-button')!, 'audio', false)
    new MediaStreamButtonController(document.getElementById('capture-tab-button')!, 'audio', true)
    // AudioInputs.addListener(() => {
    //   this.updateActiveAudioInputs()
    // })
  }

  async updateActiveAudioInputs() {
    if (AudioInputs.localAVDevice) {
      let element = document.getElementById(AudioInputsController.LOCAL_DEVICE_ELEMENT_ID)!
      element.getElementsByClassName('audio-source-label')[0]!.innerHTML = AudioInputs.localAVDevice.name
      if (!this.peakMeters.has(AudioInputsController.LOCAL_DEVICE_ELEMENT_ID)) {
        this.peakMeters.set(
          AudioInputsController.LOCAL_DEVICE_ELEMENT_ID,
          new PeakMeterController(
            element.getElementsByClassName('audio-source-peak-meter')[0] as HTMLDivElement,
            AudioInputs.localAVDevice,
            true,
          ),
        )
        const context = await AudioControl.getOrCreateAudioContext()
        AudioInputs.localAVDevice.init(context)
        context.resume()
      }
    } else {
      this.peakMeters.get(AudioInputsController.LOCAL_DEVICE_ELEMENT_ID)?.remove()
      this.peakMeters.delete(AudioInputsController.LOCAL_DEVICE_ELEMENT_ID)
    }
    if (AudioInputs.localScreenShare) {
      let element = document.getElementById(AudioInputsController.LOCAL_SCREEN_SHARE_ELEMENT_ID)!
      if (!this.peakMeters.has(AudioInputsController.LOCAL_SCREEN_SHARE_ELEMENT_ID)) {
        this.peakMeters.set(
          AudioInputsController.LOCAL_SCREEN_SHARE_ELEMENT_ID,
          new PeakMeterController(
            element.getElementsByClassName('audio-source-peak-meter')[0] as HTMLDivElement,
            AudioInputs.localScreenShare,
            true,
          ),
        )
        const context = await AudioControl.getOrCreateAudioContext()
        AudioInputs.localScreenShare.init(context)
        context.resume()
      }
    } else {
      this.peakMeters.get(AudioInputsController.LOCAL_SCREEN_SHARE_ELEMENT_ID)?.remove()
      this.peakMeters.delete(AudioInputsController.LOCAL_SCREEN_SHARE_ELEMENT_ID)
    }

    if (this.peakMeters.size == 0 && AudioControl.audioContext?.mode == AudioState.MONITORING) {
      AudioControl.closeAndRemoveAudioContext()
    }
    this.peakMeters
      .values()
      [Symbol.iterator]()
      .forEach((p) => p.draw(p))
  }

  private async getAudioContext() {
    const audioContext = await AudioControl.getOrCreateAudioContext(AudioState.MONITORING)
    audioContext.resume()
    return audioContext
  }
}
