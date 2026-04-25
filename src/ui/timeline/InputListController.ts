import { PeakMeterController } from '../PeakMeterController'
import { AudioInput } from '../../audioinputs/AudioInput'
import { AudioInputs } from '../../audioinputs/AudioInputs'
import { AudioControl, AudioState } from '../../audiocontext/AudioControl'

export class InputListController {
  readonly inputInfoListElement = document.getElementById('input-info-list')!
  readonly inputListElement = document.getElementById('input-list')!
  readonly inputControllers = new Map<string, AudioInputController>()

  constructor() {
    AudioControl.addAudioControlListener(state => {
      switch (state) {
        case AudioState.PLAYING:
        case AudioState.RECORDING:
        case AudioState.PLAYING_PAUSED:
        case AudioState.RECORDING_PAUSED:
          this.inputInfoListElement.style.display = 'none'
          this.inputListElement.style.display = 'none'
          break
        case AudioState.MONITORING:
        case AudioState.MONITORING_PAUSED:
        case AudioState.STOPPED:
          this.inputInfoListElement.style.display = ''
          this.inputListElement.style.display = ''
          break
      }
    })
    AudioInputs.addListener(async () => {
      if (AudioControl.isTimelineActive()) {
        return
      }
      const context = await AudioControl.getOrCreateAudioContext(AudioState.MONITORING)
      context.resume()
      const infoDivs = new Array<Node>()
      const inputDivs = new Array<Node>()
      const func = (input: AudioInput | null, type: AudioInputType) => {
        if (input) {
          input.init(context)
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
      }
      func(AudioInputs.localAVDevice, AudioInputType.MIC)
      func(AudioInputs.localScreenShare, AudioInputType.SCREEN_SHARE)
      AudioInputs.remoteStreams.forEach((remoteInput) => {
        func(remoteInput, AudioInputType.REMOTE)
      })
      if (infoDivs.length === 0) {
        context.close()
      }
      this.inputInfoListElement.replaceChildren(...infoDivs)
      this.inputListElement.replaceChildren(...inputDivs)
    })
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
    inputName.style.margin = '.25rem'
    inputName.style.height = '3em'
    inputName.style.overflow = 'hidden'
    inputName.style.wordBreak = 'break-all'
    inputName.style.gridArea = 'name'
    inputName.innerText = audioInput.name

    const inputIconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    inputIconSvg.style.height = '1em'
    inputIconSvg.style.width = '1em'
    inputIconSvg.style.display = 'inline'
    inputIconSvg.style.verticalAlign = 'middle'
    inputIconSvg.setAttribute('viewBox', '0 0 500 500')
    const inputIconUse = document.createElementNS('http://www.w3.org/2000/svg', 'use')
    switch (type) {
      case AudioInputType.MIC:
        inputIconUse.setAttributeNS('http://www.w3.org/1999/xlink', 'href', '#microphone')
        break
      case AudioInputType.SCREEN_SHARE:
        inputIconUse.setAttributeNS('http://www.w3.org/1999/xlink', 'href', '#screen-share')
        break
      case AudioInputType.REMOTE:
        inputIconUse.setAttributeNS('http://www.w3.org/1999/xlink', 'href', '#meeting')
        break
    }

    const muteButton = document.createElement('button')
    muteButton.className = 'clickable mute-button'
    muteButton.innerText = 'mute'
    const muteOnClick = () => {
      audioInput.mute()
      muteButton.innerText = 'unmute'
      muteButton.onclick = () => {
        audioInput.mute()
        muteButton.innerText = 'mute'
        muteButton.onclick = muteOnClick
      }
    }
    muteButton.onclick = muteOnClick

    const peakMeterDiv = document.createElement('div')
    peakMeterDiv.style.gridArea = 'meter'

    inputIconSvg.appendChild(inputIconUse)
    this.inputInfoDiv.appendChild(inputName)
    inputName.appendChild(inputIconSvg)
    this.inputInfoDiv.appendChild(muteButton)
    this.inputInfoDiv.appendChild(peakMeterDiv)

    this.peakMeter = new PeakMeterController(peakMeterDiv, audioInput, true)
    this.peakMeter.draw(this.peakMeter)
  }
}
