import { LocalMediaStreams } from '../mediastreams/LocalMediaStreams'
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
    document.getElementById('welcome-camera')!.onclick = async () => {
      await Promise.all([LocalMediaStreams.startAudioDevice(), LocalMediaStreams.startVideoDevice()])
      await startRecordingActiveInputs()
    }
    document.getElementById('welcome-screen')!.onclick = async () => {
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
