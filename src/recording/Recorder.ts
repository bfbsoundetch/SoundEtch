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
import { NotificationsController } from '../ui/NotificationsController'

export class Recorder {
  private static writingWorkerController: WorkerController | null = null

  static async startRecordingActiveAudioInputs() {
    const activeProject = await ProjectManager.getActiveProject()
    if (!activeProject) {
      throw new Error('No active project.')
    }
    return Recorder.startRecording2(AudioInputs.gatherActiveAudioInputs())
  }

  static async startRecording2(audioInputs: Array<AudioInput>) {
    const audioContext = await AudioControl.createNewAudioContext(AudioState.RECORDING)
    const workerController = Recorder.getWritingWorkerController()
    const unusedAddModuleResult = audioContext.audioWorklet.addModule('./assets/recordingAudioWorklet.js')
    const inputs = []
    const audioWorkletNodes = []
    for (const audioInput of audioInputs) {
      const track = await ProjectManager.addClipWithTrack(
        'Recording: ' + audioInput.name,
        audioInput.channelCount,
        0,
        AudioControl.startPosition,
        inputs.length,
      )
      const clipView = track.clipViews[0]!
      const ringBufferArray = RingBuffer.getStorageForCapacity(64 * 1024, Float32Array)
      const overrunSampleCount = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
      inputs.push({
        dirname: `${(await ProjectManager.getActiveProject()).id}`,
        ringBufferArray: ringBufferArray,
        channelCount: audioInput.channelCount,
        clip: cloneWithGetters(clipView.clip),
        overrunSampleCount: overrunSampleCount,
      })

      await unusedAddModuleResult
      const recordingWorkletNode = new AudioWorkletNode(audioContext, 'DiskRecordingAudioWorkletProcessor', {
        processorOptions: {
          ringBufferArray: ringBufferArray,
          channelCount: audioInput.channelCount,
          overrunSampleCount: overrunSampleCount,
        },
      })
      await audioInput.connect(recordingWorkletNode)
      audioWorkletNodes.push(recordingWorkletNode)
      workerController.worker.addEventListener('message', clipView.clip.summary.getWorkerMessageListener())
    }

    if (audioWorkletNodes.length == 0) {
      audioContext.close()
      return
    }
    workerController.setAudioWorkletNodes(audioWorkletNodes)
    workerController.start(JobType.RECORDER, inputs)
  }

  static stopRecording(stopMediaStreamTracks: boolean = true) {
    AudioControl.stop()
    if (stopMediaStreamTracks) {
      AudioInputs.gatherActiveAudioInputs().forEach((audioSource) => audioSource.stop())
    }
  }

  static async createFromUrl(url: string): Promise<Track | null> {
    const abortController = new AbortController()
    ;(window as any).processingModalController?.show('Downloading audio...', () => abortController.abort())

    try {
      const importedFile = await NetworkUtils.downloadFile(
        url,
        Recorder.filenameFromUrl(url),
        (progress) => (window as any).processingModalController?.setProgress(progress),
        abortController.signal,
      )
      ;(window as any).processingModalController?.setTitle('Importing audio...')
      ;(window as any).processingModalController?.setProgress(0)
      return await Recorder.createFromSourceFile(importedFile, abortController.signal)
    } catch (error) {
      if (isAbortError(error)) {
        Recorder.showImportCanceledNotification()
        return null
      }
      throw error
    } finally {
      ;(window as any).processingModalController?.hide()
    }
  }

  static async createFromFile(file: File): Promise<Track | null> {
    const abortController = new AbortController()
    ;(window as any).processingModalController?.show('Importing audio...', () => abortController.abort())

    try {
      return await Recorder.createFromSourceFile(file, abortController.signal)
    } catch (error) {
      if (isAbortError(error)) {
        Recorder.showImportCanceledNotification()
        return null
      }
      NotificationsController.showErrorMessage('Import failed')
      throw error
    } finally {
      ;(window as any).processingModalController?.hide()
    }
  }

  private static async createFromSourceFile(file: File, signal?: AbortSignal): Promise<Track> {
    // The demuxer is loaded only after import starts, keeping it out of the recording chunk.
    const { AudioImporter } = await import('./AudioImporter')
    const track = await AudioImporter.importFile(file, {
      signal,
      onProgress: (progress) => (window as any).processingModalController?.setProgress(progress),
    })
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

  private static showImportCanceledNotification() {
    NotificationsController.showShortDurationMessage('Audio import canceled.')
  }
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}
