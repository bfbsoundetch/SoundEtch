import { TimeUtils } from '../global/TimeUtils'
import { AudioControl, AudioState } from '../audiocontext/AudioControl'

export class ClockController {
  private readonly clockDiv = document.getElementById('clock')!

  constructor() {
    AudioControl.addAudioControlListener((state) => {
      switch (state) {
        case AudioState.PLAYING:
        case AudioState.RECORDING:
          this.draw(this)
          break
      }
    })
  }

  draw(clockController: ClockController) {
    const audioState = AudioControl.getState()
    if (audioState == AudioState.STOPPED) {
      clockController.clockDiv.innerHTML = TimeUtils.toString(0, false)
      return
    }
    clockController.clockDiv.innerHTML = TimeUtils.positionToString(
      AudioControl.audioContext!.getPosition(),
      AudioControl.audioContext!.sampleRate,
      false,
    )

    if (audioState == AudioState.PLAYING || audioState == AudioState.RECORDING) {
      requestAnimationFrame((_) => clockController.draw(clockController))
    }
  }
}
