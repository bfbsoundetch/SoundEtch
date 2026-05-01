import { AudioInputs } from '../audioinputs/AudioInputs'
import { AudioControl, AudioState } from '../audiocontext/AudioControl'
import { Recorder } from '../recording/Recorder'

export class RecordButtonController {
  private static readonly COUNTDOWN_VALUES = ['3', '2', '1']

  private readonly countdownElement = document.createElement('div')
  private countdownToken = 0
  private isCountingDown = false

  constructor(
    private readonly button: HTMLButtonElement,
    private readonly baseClassName: 'project-button' | 'meeting-button',
  ) {
    this.countdownElement.className = 'record-button-countdown'
    this.button.appendChild(this.countdownElement)

    AudioInputs.addListener(() => {
      if (this.isCountingDown && !this.hasAvailableAudioInputs()) {
        this.cancelCountdown()
        return
      }
      if (this.isStoppedState(AudioControl.getState())) {
        this.configureStoppedState()
      }
    })

    this.configureStoppedState()
  }

  configureStoppedState() {
    if (this.isCountingDown) {
      return
    }
    const hasAvailableAudioInputs = this.hasAvailableAudioInputs()
    this.button.getElementsByTagName('span')[0].innerText = hasAvailableAudioInputs
      ? 'Record'
      : 'Nothing to record. Enable a mic or screen share.'
    this.button.disabled = !hasAvailableAudioInputs
    this.button.className = `${this.baseClassName} tooltipped${hasAvailableAudioInputs ? ' clickable' : ' record-button-unavailable'}`
    this.button.onclick = hasAvailableAudioInputs ? () => void this.startCountdown() : null
    this.button.style.background = ''
    this.hideCountdown()
  }

  cancelCountdown() {
    if (!this.isCountingDown) {
      return
    }
    this.countdownToken += 1
    this.isCountingDown = false
    this.hideCountdown()
    if (this.isStoppedState(AudioControl.getState())) {
      this.configureStoppedState()
    }
  }

  private async startCountdown() {
    if (this.isCountingDown || !this.hasAvailableAudioInputs() || !this.isStoppedState(AudioControl.getState())) {
      this.configureStoppedState()
      return
    }

    this.isCountingDown = true
    const countdownToken = ++this.countdownToken
    this.button.disabled = false
    this.button.className = `${this.baseClassName} record-button-counting-down`
    this.button.onclick = null

    for (const countdownValue of RecordButtonController.COUNTDOWN_VALUES) {
      if (!this.shouldContinueCountdown(countdownToken)) {
        return
      }
      this.countdownElement.innerText = countdownValue
      await new Promise((resolve) => window.setTimeout(resolve, 1000))
    }

    if (!this.shouldContinueCountdown(countdownToken)) {
      return
    }

    this.isCountingDown = false
    this.hideCountdown()

    try {
      await Recorder.startRecordingActiveAudioInputs()
    } finally {
      if (this.isStoppedState(AudioControl.getState())) {
        this.configureStoppedState()
      }
    }
  }

  private shouldContinueCountdown(countdownToken: number) {
    if (countdownToken !== this.countdownToken || !this.isCountingDown) {
      return false
    }
    if (!this.hasAvailableAudioInputs() || !this.isStoppedState(AudioControl.getState())) {
      this.cancelCountdown()
      return false
    }
    return true
  }

  private hasAvailableAudioInputs() {
    return AudioInputs.gatherActiveAudioInputs().length > 0
  }

  private hideCountdown() {
    this.button.classList.remove('record-button-counting-down')
    this.countdownElement.innerText = ''
  }

  private isStoppedState(state: AudioState) {
    return state == AudioState.MONITORING || state == AudioState.MONITORING_PAUSED || state == AudioState.STOPPED
  }
}
