import { BottomPanelController } from './BottomPanelController'

/** The bottom panel's Output tab, which will arrange the video output and hold the audio output's effects. */
export class OutputPanelController {
  constructor() {
    const message = document.createElement('p')
    message.className = 'bottom-panel-message'
    message.textContent = 'Coming soon: arrange the video output and add effects to the audio output here.'
    BottomPanelController.getInstance().open({ tab: 'output', owner: this, body: message })
  }
}
