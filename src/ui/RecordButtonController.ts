import { AudioInputs } from '../audioinputs/AudioInputs'
import { VideoInputs } from '../videoinputs/VideoInputs'
import { AudioControl, AudioState } from '../audiocontext/AudioControl'
import type { RecordingActivity } from '../remote/RemoteMediaClient3'
import { announce } from './LiveAnnouncer'

export class RecordButtonController {
  private static readonly COUNTDOWN_VALUES = ['3', '2', '1']

  private readonly countdownElement = document.createElement('div')
  private countdownToken = 0
  private isCountingDown = false

  constructor(
    private readonly button: HTMLButtonElement,
    private readonly baseClassName: 'project-button' | 'meeting-button',
    private readonly recordingActivityListener: ((recordingActivity: RecordingActivity) => void) | null = null,
  ) {
    this.countdownElement.className = 'record-button-countdown'
    this.button.appendChild(this.countdownElement)

    const handleInputChange = () => {
      if (this.isCountingDown && !this.hasAvailableInputs()) {
        this.cancelCountdown()
        return
      }
      if (this.isStoppedState(AudioControl.getState())) {
        this.configureStoppedState()
      }
    }
    AudioInputs.addListener(handleInputChange)
    VideoInputs.addListener(handleInputChange)

    this.configureStoppedState()
  }

  configureStoppedState() {
    if (this.isCountingDown) {
      return
    }
    const hasAvailableInputs = this.hasAvailableInputs()
    this.button.getElementsByTagName('span')[0].innerText = hasAvailableInputs
      ? 'Record'
      : 'Nothing to record. Enable a mic, camera or screen share.'
    this.button.disabled = false
    this.button.setAttribute('aria-disabled', String(!hasAvailableInputs))
    this.button.className = `${this.baseClassName} tooltipped${hasAvailableInputs ? ' clickable' : ' record-button-unavailable'}`
    this.button.onclick = hasAvailableInputs
      ? this.hasRemoteInputs()
        ? () => void this.startCountdown()
        : () => void this.startRecording()
      : null
    this.button.style.background = ''
    this.hideCountdown()
  }

  cancelCountdown() {
    if (!this.isCountingDown) {
      return
    }
    const countdownId = this.countdownToken
    this.countdownToken += 1
    this.isCountingDown = false
    this.recordingActivityListener?.({ state: 'idle', countdownId: countdownId })
    this.hideCountdown()
    announce('Recording countdown canceled')
    if (this.isStoppedState(AudioControl.getState())) {
      this.configureStoppedState()
    }
  }

  private async startCountdown() {
    if (this.isCountingDown || !this.hasAvailableInputs() || !this.isStoppedState(AudioControl.getState())) {
      this.configureStoppedState()
      return
    }

    this.isCountingDown = true
    announce(`Recording starts in ${RecordButtonController.COUNTDOWN_VALUES.length} seconds`)
    const countdownToken = ++this.countdownToken
    this.button.disabled = false
    this.button.className = `${this.baseClassName} record-button-counting-down`
    this.button.onclick = null
    this.recordingActivityListener?.({
      state: 'countdown',
      countdownId: countdownToken,
      durationMs: RecordButtonController.COUNTDOWN_VALUES.length * 1000,
    })

    for (const countdownValue of RecordButtonController.COUNTDOWN_VALUES) {
      if (!this.shouldContinueCountdown(countdownToken)) {
        return
      }
      this.countdownElement.innerText = countdownValue
      this.button.setAttribute('aria-label', `Recording starts in ${countdownValue}`)
      await new Promise((resolve) => window.setTimeout(resolve, 1000))
    }

    if (!this.shouldContinueCountdown(countdownToken)) {
      return
    }

    this.isCountingDown = false
    this.hideCountdown()

    try {
      await this.startRecording()
    } catch (error) {
      this.recordingActivityListener?.({ state: 'idle', countdownId: countdownToken })
      throw error
    } finally {
      if (this.isStoppedState(AudioControl.getState())) {
        this.configureStoppedState()
      }
    }
  }

  private async startRecording() {
    // Recording is loaded only after the user requests it, keeping it out of the initial timeline chunk.
    const { Recorder } = await import('../recording/Recorder')
    await Recorder.startRecordingActiveInputs()
  }

  private shouldContinueCountdown(countdownToken: number) {
    if (countdownToken !== this.countdownToken || !this.isCountingDown) {
      return false
    }
    if (!this.hasAvailableInputs() || !this.isStoppedState(AudioControl.getState())) {
      this.cancelCountdown()
      return false
    }
    return true
  }

  private hasAvailableInputs() {
    return AudioInputs.gatherActiveAudioInputs().length > 0 || VideoInputs.gather().length > 0
  }

  private hasRemoteInputs() {
    return AudioInputs.getRemoteInputs().length > 0 || VideoInputs.gather().some((input) => input.remote)
  }

  private hideCountdown() {
    this.button.classList.remove('record-button-counting-down')
    this.countdownElement.innerText = ''
    this.button.removeAttribute('aria-label')
  }

  private isStoppedState(state: AudioState) {
    return state == AudioState.MONITORING || state == AudioState.MONITORING_PAUSED || state == AudioState.STOPPED
  }
}
