import { AudioInputs } from '../audioinputs/AudioInputs'
import { AudioControl, AudioState } from '../audiocontext/AudioControl'
import { Recorder } from '../recording/Recorder'
import type { RecordingActivity } from '../remote/RemoteMediaClient3'

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
    this.button.onclick = hasAvailableAudioInputs
      ? this.hasRemoteAudioInputs()
        ? () => void this.startCountdown()
        : Recorder.startRecordingActiveAudioInputs
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
      await new Promise((resolve) => window.setTimeout(resolve, 1000))
    }

    if (!this.shouldContinueCountdown(countdownToken)) {
      return
    }

    this.isCountingDown = false
    this.hideCountdown()

    try {
      await Recorder.startRecordingActiveAudioInputs()
    } catch (error) {
      this.recordingActivityListener?.({ state: 'idle', countdownId: countdownToken })
      throw error
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

  private hasRemoteAudioInputs() {
    return AudioInputs.remoteStreams.size > 0
  }

  private hideCountdown() {
    this.button.classList.remove('record-button-counting-down')
    this.countdownElement.innerText = ''
  }

  private isStoppedState(state: AudioState) {
    return state == AudioState.MONITORING || state == AudioState.MONITORING_PAUSED || state == AudioState.STOPPED
  }
}
