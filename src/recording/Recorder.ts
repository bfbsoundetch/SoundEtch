import { Track } from '../project/Track'
import { RingBuffer } from 'ringbuf.js'
import { AudioInput } from '../audioinputs/AudioInput'
import { AudioInputs } from '../audioinputs/AudioInputs'
import { NetworkUtils } from '../NetworkUtils'
import { ProjectManager } from '../project/ProjectManager'
import { WorkerController } from '../audiocontext/WorkerController'
import { JobType } from '../audiocontext/ControllableWorkerJob'
import { AudioControl, AudioState } from '../audiocontext/AudioControl'
import { cloneWithGetters } from '../global/ObjectUtils'
import { ClipView } from '../project/ClipView'

export class Recorder {
  private static writingWorkerController: WorkerController | null = null

  static async startRecordingActiveAudioInputs() {
    const activeProject = await ProjectManager.getActiveProject()
    if (!activeProject) {
      throw new Error('No active project.')
    }
    Recorder.startRecording2(AudioInputs.gatherActiveAudioInputs())
  }

  static async startRecording2(audioInputs: Array<AudioInput>) {
    const audioContext = await AudioControl.createNewAudioContext(AudioState.RECORDING)
    const workerController = Recorder.getWritingWorkerController()
    const unusedAddModuleResult = audioContext.audioWorklet.addModule('./assets/recordingAudioWorklet.js')
    const inputs = []
    const audioWorkletNodes = []
    for (const audioInput of audioInputs) {
      const track = await ProjectManager.addClipWithTrack(
        audioInput.name,
        audioInput.channelCount,
        0,
        AudioControl.startPosition,
        'Recording',
      )
      const clipView = track.clipViews[0]!
      const ringBufferArray = RingBuffer.getStorageForCapacity(64 * 1024, Float32Array)

      inputs.push({
        dirname: `${(await ProjectManager.getActiveProject()).id}`,
        ringBufferArray: ringBufferArray,
        channelCount: audioInput.channelCount,
        clip: cloneWithGetters(clipView.clip),
      })

      await unusedAddModuleResult
      const recordingWorkletNode = new AudioWorkletNode(audioContext, 'DiskRecordingAudioWorkletProcessor', {
        processorOptions: {
          ringBufferArray: ringBufferArray,
          channelCount: audioInput.channelCount,
        },
      })
      audioWorkletNodes.push(recordingWorkletNode)
      workerController.worker.addEventListener('message', clipView.clip.summary.getWorkerMessageListener())
      audioInput.connect(recordingWorkletNode)
    }
    const r = await audioContext.audioWorklet.addModule(
      new URL('../audiocontext/ReportingAudioWorkletProcessor.js', import.meta.url),
    )

    const reporterNode = new AudioWorkletNode(audioContext, 'ReportingAudioWorkletProcessor', {
      processorOptions: {
        position: new Float32Array(new SharedArrayBuffer(4)),
      },
    })
    if (audioWorkletNodes.length == 0) {
      audioContext.close()
      return
    }
    reporterNode.connect(audioContext.destination)
    workerController.setAudioWorkletNode(audioWorkletNodes)
    workerController.start(JobType.RECORDER, inputs)
  }

  static stopRecording(stopMediaStreamTracks: boolean = true) {
    AudioControl.stop()
    if (stopMediaStreamTracks) {
      AudioInputs.gatherActiveAudioInputs().forEach((audioSource) => audioSource.stop())
    }
  }

  static async createFromUrl(url: string): Promise<Track> {
    const responseBody = await NetworkUtils.getSuccessfulResponseBody(url)
    return Recorder.createFromArrayBuffer(responseBody, url)
  }

  static async createFromFile(file: File): Promise<Track> {
    const bytes = await file.arrayBuffer()
    return Recorder.createFromArrayBuffer(bytes, file.name)
  }

  private static async createFromArrayBuffer(arrayBuffer: ArrayBuffer, name: string): Promise<Track> {
    const activeProject = await ProjectManager.getActiveProject()
    const audioBuffer = await (await globalThis.createNewAudioContext()).decodeAudioData(arrayBuffer)

    const track = await ProjectManager.addClipWithTrack(
      name,
      audioBuffer.numberOfChannels,
      0, // to be overwritten
      AudioControl.startPosition,
      'File',
    )
    const clipView = track.clipViews[0]!
    const clip = clipView.clip
    const dirname = activeProject.id
    const filename = clip.filename
    const worker = new Worker(new URL('./AudioFileWritingWorker.js', import.meta.url), {
      type: 'module',
    })
    const audioArray = new Array<Float32Array>(audioBuffer.numberOfChannels)
    for (let i = 0; i < audioBuffer.numberOfChannels; ++i) {
      audioArray[i] = audioBuffer.getChannelData(i)
    }
    worker.postMessage({
      type: 'batch',
      dirname: dirname,
      filename: filename,
      audioArray: audioArray,
      summary: clip.summary,
    })
    worker.addEventListener('message', clip.summary.getWorkerMessageListener())
    worker.addEventListener('message', (e) => {
      if (e.data.type == 'finished') {
        track.clipViews[0] = new ClipView(clip, 0, AudioControl.startPosition, e.data.length)
        ProjectManager.saveClip(clip)
        ProjectManager.saveTrack(track)
        ;(window as any).trackListController.draw()
      }
    })
    return track
  }

  static getWritingWorkerController(): WorkerController {
    if (Recorder.writingWorkerController) {
      return Recorder.writingWorkerController
    }
    return (Recorder.writingWorkerController = new WorkerController())
  }
}
