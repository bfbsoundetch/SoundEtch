import { PeakMeterController } from '../PeakMeterController'
import { AudioInput } from '../../audioinputs/AudioInput'
import { AudioInputs } from '../../audioinputs/AudioInputs'
import { AudioControl, AudioState } from '../../audiocontext/AudioControl'
import { LocalMediaStreams } from '../../mediastreams/LocalMediaStreams'

export class InputListController {
  readonly inputInfoListElement = document.getElementById('input-info-list')!
  readonly inputListElement = document.getElementById('input-list')!
  readonly inputControllers = new Map<string, AudioInputController>()

  constructor() {
    AudioControl.addAudioControlListener((state) => {
      switch (state) {
        case AudioState.PLAYING:
        case AudioState.RECORDING:
        case AudioState.PLAYING_PAUSED:
        case AudioState.RECORDING_PAUSED:
          this.inputInfoListElement.hidden = true
          this.inputListElement.hidden = true
          break
        case AudioState.MONITORING:
        case AudioState.MONITORING_PAUSED:
        case AudioState.STOPPED:
          this.inputInfoListElement.hidden = false
          this.inputListElement.hidden = false
          break
      }
      if (state == AudioState.STOPPED && AudioInputs.gatherActiveAudioInputs().length > 0) {
        void this.updateInputs()
      }
    })
    AudioInputs.addListener(() => void this.updateInputs())
  }

  private async updateInputs() {
    const state = AudioControl.getState()
    if (state != AudioState.STOPPED && state != AudioState.MONITORING && state != AudioState.MONITORING_PAUSED) {
      return
    }
    if (AudioInputs.gatherActiveAudioInputs().length == 0) {
      this.inputInfoListElement.replaceChildren()
      this.inputListElement.replaceChildren()
      if (AudioControl.audioContext?.mode == AudioState.MONITORING) {
        await AudioControl.closeAndRemoveAudioContext()
      }
      return
    }
    const context = await AudioControl.startMonitoring()
    if (!context || context.state == 'closed') {
      return
    }
    const infoDivs = new Array<Node>()
    const inputDivs = new Array<Node>()
    const func = (input: AudioInput, type: AudioInputType) => {
      void input.init(context)
      const id = `${input.id}-list-item`
      const inputController = this.inputControllers.get(id)
      if (inputController) {
        infoDivs.push(inputController.inputInfoDiv)
        inputDivs.push(inputController.inputDiv)
      } else {
        const newInputController = new AudioInputController(id, input, type)
        this.inputControllers.set(id, newInputController)
        infoDivs.push(newInputController.inputInfoDiv)
        inputDivs.push(newInputController.inputDiv)
      }
    }
    if (LocalMediaStreams.localAVDeviceMediaStream.getAudioTracks().length > 0) {
      func(AudioInputs.localAVDevice, AudioInputType.MIC)
    }
    if (LocalMediaStreams.localScreenMediaStream.getAudioTracks().length > 0) {
      func(AudioInputs.localScreenShare, AudioInputType.SCREEN_SHARE)
    }
    AudioInputs.getRemoteInputs().forEach((remoteInput) => {
      func(remoteInput, AudioInputType.REMOTE)
    })
    this.inputInfoListElement.replaceChildren(...infoDivs)
    this.inputListElement.replaceChildren(...inputDivs)
  }
}

export enum AudioInputType {
  MIC,
  SCREEN_SHARE,
  REMOTE,
}

class AudioInputController {
  readonly inputDiv = document.createElement('div')
  readonly inputInfoDiv = document.createElement('div')

  readonly peakMeter: PeakMeterController

  constructor(id: string, audioInput: AudioInput, type: AudioInputType) {
    this.inputDiv.classList = 'tracklist-item'

    this.inputInfoDiv.classList = 'tracklist-item input-info'
    this.inputInfoDiv.id = id

    this.inputDiv.style.height = `${7 * audioInput.channelCount + 1.5}rem`
    this.inputInfoDiv.style.height = `${7 * audioInput.channelCount + 1.5}rem`

    const inputName = document.createElement('div')
    inputName.className = 'input-name'
    inputName.innerText = audioInput.name

    const inputIconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    inputIconSvg.classList.add('input-icon')
    inputIconSvg.setAttribute('viewBox', '0 0 500 500')
    const inputIconUse = document.createElementNS('http://www.w3.org/2000/svg', 'use')
    inputIconSvg.setAttribute('role', 'img')
    switch (type) {
      case AudioInputType.MIC:
        inputIconUse.setAttributeNS('http://www.w3.org/1999/xlink', 'href', '#microphone')
        inputIconSvg.setAttribute('aria-label', 'Microphone')
        break
      case AudioInputType.SCREEN_SHARE:
        inputIconUse.setAttributeNS('http://www.w3.org/1999/xlink', 'href', '#screen-share')
        inputIconSvg.setAttribute('aria-label', 'Screen share')
        break
      case AudioInputType.REMOTE:
        inputIconUse.setAttributeNS('http://www.w3.org/1999/xlink', 'href', '#meeting')
        inputIconSvg.setAttribute('aria-label', 'Guest')
        break
    }

    const muteButton = document.createElement('button')
    muteButton.type = 'button'
    muteButton.className = 'clickable mute-button'
    muteButton.innerText = 'mute'
    muteButton.setAttribute('aria-label', `Mute ${audioInput.name}`)
    const muteOnClick = () => {
      audioInput.mute()
      muteButton.innerText = 'unmute'
      muteButton.setAttribute('aria-label', `Unmute ${audioInput.name}`)
      muteButton.onclick = () => {
        audioInput.unmute()
        muteButton.innerText = 'mute'
        muteButton.setAttribute('aria-label', `Mute ${audioInput.name}`)
        muteButton.onclick = muteOnClick
      }
    }
    muteButton.onclick = muteOnClick

    const peakMeterDiv = document.createElement('div')
    peakMeterDiv.className = 'input-peak-meter'

    inputIconSvg.appendChild(inputIconUse)
    this.inputInfoDiv.appendChild(inputName)
    inputName.appendChild(inputIconSvg)
    this.inputInfoDiv.appendChild(muteButton)
    this.inputInfoDiv.appendChild(peakMeterDiv)

    this.peakMeter = new PeakMeterController(peakMeterDiv, audioInput, true, audioInput.channelCount)
    this.peakMeter.draw(this.peakMeter)
    this.peakMeter.setLabel(`${audioInput.name} input level`)
  }
}
