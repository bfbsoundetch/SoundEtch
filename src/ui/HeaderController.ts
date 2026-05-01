import { Player } from '../playback/Player'
import { AudioControl, AudioState } from '../audiocontext/AudioControl'
import { TrackListController } from './timeline/TrackListController'
import { RecordButtonController } from './RecordButtonController'

export class HeaderController {
  private firstHeaderButton = document.getElementById('first-header-button') as HTMLButtonElement
  private secondHeaderButton = document.getElementById('second-header-button') as HTMLButtonElement
  private thirdHeaderButton = document.getElementById('third-header-button') as HTMLButtonElement
  private readonly recordButtonController = new RecordButtonController(this.firstHeaderButton, 'project-button')

  constructor() {
    AudioControl.addAudioControlListener((state) => {
      switch (state) {
        case AudioState.PLAYING:
        case AudioState.RECORDING:
          this.handleSwitchToActiveState()
          break
        case AudioState.MONITORING:
        case AudioState.STOPPED:
          this.handleSwitchToStoppedState()
          break
        case AudioState.PLAYING_PAUSED:
        case AudioState.RECORDING_PAUSED:
          this.handleSwitchToPausedState()
          break
      }
    })
  }

  private handleSwitchToActiveState() {
    this.recordButtonController.cancelCountdown()
    if (AudioControl.getState() == AudioState.PLAYING) {
      ;(this.firstHeaderButton.getElementsByClassName('play')[0] as SVGUseElement).style.opacity = '1'
      ;(this.firstHeaderButton.getElementsByClassName('record')[0] as SVGUseElement).style.opacity = '0'
      this.firstHeaderButton.getElementsByTagName('span')[0].innerText = 'Playing'
    } else {
      ;(this.firstHeaderButton.getElementsByClassName('play')[0] as SVGUseElement).style.opacity = '0'
      ;(this.firstHeaderButton.getElementsByClassName('record')[0] as SVGUseElement).style.opacity = '1'
      this.firstHeaderButton.getElementsByTagName('span')[0].innerText = 'Recording'
    }
    this.firstHeaderButton.getElementsByTagName('span')[0].style.visibility = 'invisible'
    this.firstHeaderButton.disabled = false
    this.firstHeaderButton.className = 'project-button tooltipped animated-brightness'
    this.firstHeaderButton.onclick = () => {}
    this.firstHeaderButton.style.background = 'rgba(0,0,0,.2)'
    ;(this.secondHeaderButton.getElementsByClassName('pause')[0] as SVGUseElement).style.opacity = '1'
    ;(this.secondHeaderButton.getElementsByClassName('play')[0] as SVGUseElement).style.opacity = '0'
    this.secondHeaderButton.getElementsByTagName('span')[0].innerText = 'Pause'
    this.secondHeaderButton.onclick = AudioControl.pause
    this.secondHeaderButton.style.background = 'none'
    ;(this.thirdHeaderButton.getElementsByClassName('stop')[0] as SVGUseElement).style.opacity = '1'
    ;(this.thirdHeaderButton.getElementsByClassName('plus')[0] as SVGUseElement).style.opacity = '0'
    this.thirdHeaderButton.getElementsByTagName('span')[0].innerText = 'Stop'
    this.thirdHeaderButton.onclick = AudioControl.stop
  }

  private handleSwitchToPausedState() {
    this.recordButtonController.cancelCountdown()
    if (AudioControl.getState() == AudioState.PLAYING_PAUSED) {
      ;(this.firstHeaderButton.getElementsByClassName('play')[0] as SVGUseElement).style.opacity = '1'
      ;(this.firstHeaderButton.getElementsByClassName('record')[0] as SVGUseElement).style.opacity = '0'
      this.firstHeaderButton.getElementsByTagName('span')[0].innerText = 'Resume Playing'
    } else {
      ;(this.firstHeaderButton.getElementsByClassName('play')[0] as SVGUseElement).style.opacity = '0'
      ;(this.firstHeaderButton.getElementsByClassName('record')[0] as SVGUseElement).style.opacity = '1'
      this.firstHeaderButton.getElementsByTagName('span')[0].innerText = 'Resume Recording'
    }
    this.firstHeaderButton.disabled = false
    this.firstHeaderButton.className = 'project-button tooltipped clickable'
    this.firstHeaderButton.onclick = AudioControl.unpause
    ;(this.secondHeaderButton.getElementsByClassName('pause')[0] as SVGUseElement).style.opacity = '1'
    ;(this.secondHeaderButton.getElementsByClassName('play')[0] as SVGUseElement).style.opacity = '0'
    this.secondHeaderButton.getElementsByTagName('span')[0].innerText = 'Unpause'
    this.secondHeaderButton.onclick = AudioControl.unpause
    this.secondHeaderButton.style.background = 'rgba(0,0,0,.2)'
    ;(this.thirdHeaderButton.getElementsByClassName('stop')[0] as SVGUseElement).style.opacity = '1'
    ;(this.thirdHeaderButton.getElementsByClassName('plus')[0] as SVGUseElement).style.opacity = '0'
    this.thirdHeaderButton.getElementsByTagName('span')[0].innerText = 'Stop'
    this.thirdHeaderButton.onclick = AudioControl.stop
  }

  private handleSwitchToStoppedState() {
    ;(this.firstHeaderButton.getElementsByClassName('play')[0] as SVGUseElement).style.opacity = '0'
    ;(this.firstHeaderButton.getElementsByClassName('record')[0] as SVGUseElement).style.opacity = '1'
    this.firstHeaderButton.getElementsByTagName('span')[0].innerText = 'Record'
    this.recordButtonController.configureStoppedState()
    this.firstHeaderButton.style.background = 'none'
    ;(this.secondHeaderButton.getElementsByClassName('pause')[0] as SVGUseElement).style.opacity = '0'
    ;(this.secondHeaderButton.getElementsByClassName('play')[0] as SVGUseElement).style.opacity = '1'
    this.secondHeaderButton.getElementsByTagName('span')[0].innerText = 'Play'
    this.secondHeaderButton.onclick = () =>
      Player.playActiveProject2(((window as any).trackListController as TrackListController).selectedRegion)
    this.secondHeaderButton.style.background = 'none'
    ;(this.thirdHeaderButton.getElementsByClassName('stop')[0] as SVGUseElement).style.opacity = '0'
    ;(this.thirdHeaderButton.getElementsByClassName('plus')[0] as SVGUseElement).style.opacity = '1'
    this.thirdHeaderButton.getElementsByTagName('span')[0].innerText = 'Add clip...'
    this.thirdHeaderButton.onclick = this.showAddClipModal
  }

  private showAddClipModal() {
    ;(window as any).showDialog(document.getElementById('add-clip-modal'))
  }
}
