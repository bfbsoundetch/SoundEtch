import { AudioControl, AudioState } from '../audiocontext/AudioControl'
import type { TrackListController } from './timeline/TrackListController'
import { RecordButtonController } from './RecordButtonController'
import { announce } from './LiveAnnouncer'

export class HeaderController {
  private firstHeaderButton = document.getElementById('first-header-button') as HTMLButtonElement
  private secondHeaderButton = document.getElementById('second-header-button') as HTMLButtonElement
  private thirdHeaderButton = document.getElementById('third-header-button') as HTMLButtonElement
  private readonly recordButtonController = new RecordButtonController(this.firstHeaderButton, 'project-button')
  private previousState: AudioState | null = null
  private static readonly STATE_ANNOUNCEMENTS: Partial<Record<AudioState, string>> = {
    [AudioState.RECORDING]: 'Recording',
    [AudioState.PLAYING]: 'Playing',
    [AudioState.RECORDING_PAUSED]: 'Recording paused',
    [AudioState.PLAYING_PAUSED]: 'Playback paused',
  }

  constructor() {
    AudioControl.addAudioControlListener((state) => {
      this.announceStateChange(state)
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

  private announceStateChange(state: AudioState) {
    const previousState = this.previousState
    this.previousState = state
    if (state === previousState) {
      return
    }
    const message = HeaderController.STATE_ANNOUNCEMENTS[state]
    if (message) {
      announce(message)
    } else if (
      (state == AudioState.STOPPED || state == AudioState.MONITORING) &&
      previousState !== null &&
      HeaderController.STATE_ANNOUNCEMENTS[previousState] !== undefined
    ) {
      announce('Stopped')
    }
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
    this.firstHeaderButton.setAttribute('aria-disabled', 'true')
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
    this.firstHeaderButton.setAttribute('aria-disabled', 'false')
    this.firstHeaderButton.className = 'project-button tooltipped clickable'
    this.firstHeaderButton.onclick = AudioControl.unpause
    ;(this.secondHeaderButton.getElementsByClassName('pause')[0] as SVGUseElement).style.opacity = '0'
    ;(this.secondHeaderButton.getElementsByClassName('play')[0] as SVGUseElement).style.opacity = '1'
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
    this.secondHeaderButton.onclick = async () => {
      // Playback is loaded only after the user requests it, keeping it out of the initial timeline chunk.
      const { Player } = await import('../playback/Player')
      await Player.playActiveProject2(((window as any).trackListController as TrackListController).selectedRegion)
    }
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
