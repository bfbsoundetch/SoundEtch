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
import { AudioImporter } from './AudioImporter'
import { AudioImporter2 } from './AudioImporter2'

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
    const importedFile = new File([responseBody], Recorder.filenameFromUrl(url))
    return Recorder.createFromSourceFile(importedFile)
  }

  static async createFromFile(file: File): Promise<Track> {
    return Recorder.createFromSourceFile(file)
  }

  private static async createFromSourceFile(file: File): Promise<Track> {
    const activeProject = await ProjectManager.getActiveProject()
    const decoderConfig = await AudioImporter.getDecoderConfig(file)

    const track = await ProjectManager.addClipWithTrack(
      file.name,
      decoderConfig.numberOfChannels,
      0, // to be overwritten
      AudioControl.startPosition,
      'File',
    )
    const clipView = track.clipViews[0]!
    const clip = clipView.clip
    const importResult = await AudioImporter2.importFile(file, activeProject, track, decoderConfig)
    // const importResult = await AudioImporter.importFile(file, activeProject, track)
    track.clipViews[0] = new ClipView(clip, 0, AudioControl.startPosition, importResult.length)
    await ProjectManager.saveClip(clip)
    await ProjectManager.saveTrack(track)
    ;(window as any).trackListController.draw()
    return track
  }

  private static filenameFromUrl(url: string): string {
    try {
      const urlObject = new URL(url)
      const pathname = decodeURIComponent(urlObject.pathname)
      const basename = pathname.split('/').pop()
      return basename && basename.length > 0 ? basename : url
    } catch (_) {
      return url
    }
  }

  static getWritingWorkerController(): WorkerController {
    if (Recorder.writingWorkerController) {
      return Recorder.writingWorkerController
    }
    return (Recorder.writingWorkerController = new WorkerController())
  }
}
