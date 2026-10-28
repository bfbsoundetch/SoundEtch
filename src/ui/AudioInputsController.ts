import { BottomPanelController } from './BottomPanelController'
import { MediaStreamButtonController } from './MediaStreamButtonController'

export class AudioInputsController {
  constructor() {
    new MediaStreamButtonController(document.getElementById('mic-button')!, 'audio', false)
    new MediaStreamButtonController(document.getElementById('camera-button')!, 'video', false, () =>
      BottomPanelController.getInstance().reveal('inputs'),
    )
    new MediaStreamButtonController(document.getElementById('capture-tab-button')!, 'audio', true)
  }
}
