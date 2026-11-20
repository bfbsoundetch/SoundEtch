import { LocalMediaStreams } from '../mediastreams/LocalMediaStreams'
import { RecordingModeSetting } from '../recording/RecordingMode'
import type { Recorder } from '../recording/Recorder'

interface WelcomePageWindow extends Window {
  loadRecorder(): Promise<typeof Recorder>
}

async function startRecordingActiveInputs() {
  const Recorder = await (window as unknown as WelcomePageWindow).loadRecorder()
  await Recorder.startRecordingActiveInputs()
}

export class WelcomePageController {
  constructor() {
    document.getElementById('welcome-mic')!.onclick = async () => {
      await LocalMediaStreams.startAudioDevice()
      await startRecordingActiveInputs()
    }
    // These choices ask for video, which a previously chosen audio-only mode would leave out.
    document.getElementById('welcome-camera')!.onclick = async () => {
      RecordingModeSetting.set('audio-video')
      await Promise.all([LocalMediaStreams.startAudioDevice(), LocalMediaStreams.startVideoDevice()])
      await startRecordingActiveInputs()
    }
    document.getElementById('welcome-screen')!.onclick = async () => {
      RecordingModeSetting.set('audio-video')
      await LocalMediaStreams.startCapturingTab()
      await startRecordingActiveInputs()
    }
    document.getElementById('welcome-file')!.onclick = async () => {
      ;(window as any).showDialog(document.getElementById('add-clip-modal'))
    }
    document.getElementById('welcome-meet')!.onclick = async () => {
      ;(window as any).showDialog(document.getElementById('meeting-room'))
    }
  }
}
