import { MediaStreamButtonController } from './MediaStreamButtonController'

export class AudioInputsController {
  constructor() {
    new MediaStreamButtonController(document.getElementById('mic-button')!, 'audio', false)
    new MediaStreamButtonController(document.getElementById('camera-button')!, 'video', false)
    new MediaStreamButtonController(document.getElementById('capture-tab-button')!, 'audio', true)
  }
}
