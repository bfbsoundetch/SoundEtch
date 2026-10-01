import { LocalMediaStreams } from '../mediastreams/LocalMediaStreams'
import { Recorder } from '../recording/Recorder'

export class WelcomePageController {
    constructor() {
        document.getElementById('welcome-mic')!.onclick = async () => {
            await LocalMediaStreams.startAudioDevice()
            await Recorder.startRecordingActiveAudioInputs()
        }
        document.getElementById('welcome-screen')!.onclick = async () => {
            await LocalMediaStreams.startCapturingTab()
            await Recorder.startRecordingActiveAudioInputs()
        }
        document.getElementById('welcome-file')!.onclick = async () => {
            ;(window as any).showDialog(document.getElementById('add-clip-modal'))
        }
        document.getElementById('welcome-meet')!.onclick = async () => {
            ;(window as any).showDialog(document.getElementById('meeting-room'))
        }
    }
}