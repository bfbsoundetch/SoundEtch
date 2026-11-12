import { Track } from '../project/Track'
import { RingBuffer } from 'ringbuf.js'
import { AudioInput } from '../audioinputs/AudioInput'
import { AudioInputs } from '../audioinputs/AudioInputs'
import { VideoInputs, type VideoInput } from '../videoinputs/VideoInputs'
import { NetworkUtils } from '../NetworkUtils'
import { ProjectManager } from '../project/ProjectManager'
import { WorkerController } from '../audiocontext/WorkerController'
import { JobType } from '../audiocontext/ControllableWorkerJob'
import { AudioControl, AudioState } from '../audiocontext/AudioControl'
import type { EnhancedAudioContext } from '../audiocontext/EnhancedAudioContext'
import { cloneWithGetters } from '../global/ObjectUtils'
import { NotificationsController } from '../ui/NotificationsController'
import { MediaImporter } from './MediaImporter'
import { VideoRecordingSession } from './VideoRecordingSession'
import type { ProcessingModalController } from '../ui/ProcessingModalController'
import type { TrackListController } from '../ui/timeline/TrackListController'

type RecorderWindow = typeof window & {
  readonly processingModalController?: ProcessingModalController
  readonly trackListController: TrackListController
}

export class Recorder {
  private static writingWorkerController: WorkerController | null = null
  /**
   * The latest recording's audio job. The next recording starts after it because both share one worker, and a stale
   * `finished` would end the new recording's worklets through `WorkerController.finish()`.
   */
  private static audioWriting: Promise<void> = Promise.resolve()
  private static readonly unsettledRecordings = new Set<Promise<void>>()

  static async startRecordingActiveInputs() {
    const activeProject = await ProjectManager.getActiveProject()
    if (!activeProject) {
      throw new Error('No active project.')
    }
    return Recorder.startRecording(AudioInputs.gatherActiveAudioInputs(), VideoInputs.gather())
  }

  /** One new track per source; a person's or device's audio and video share one linked clip. */
  static async startRecording(audioInputs: Array<AudioInput>, videoInputs: Array<VideoInput>) {
    await Recorder.audioWriting
    const audioContext = await AudioControl.createNewAudioContext(AudioState.RECORDING)
    let failed = false
    const onError = (error: Error) => {
      if (failed) return
      failed = true
      if (audioContext.state != 'closed') void audioContext.close()
      NotificationsController.showErrorMessage(
        error.name == 'QuotaExceededError'
          ? 'Recording stopped because browser storage is full. The saved portion has been kept; the end may be missing. Free space before recording again.'
          : `Recording stopped: ${error.message}`,
      )
    }
    const writers = new Array<Promise<void>>()
    const connected = Recorder.connectRecording(audioContext, audioInputs, videoInputs, onError, writers).catch(
      (error) => onError(error instanceof Error ? error : new Error(String(error))),
    )
    const settled = connected.then(() => Promise.allSettled(writers)).then(() => undefined)
    Recorder.unsettledRecordings.add(settled)
    void settled.finally(() => Recorder.unsettledRecordings.delete(settled))
    await connected
  }

  /**
   * Stops playback, monitoring, or recording, then waits until every recording's audio is written and its video clips
   * are saved. Failures were already reported by the recording's error handler.
   */
  static async stopAndWaitForRecordings(): Promise<void> {
    await AudioControl.stop()
    await Promise.all(Recorder.unsettledRecordings)
  }

  private static async connectRecording(
    audioContext: EnhancedAudioContext,
    audioInputs: Array<AudioInput>,
    videoInputs: Array<VideoInput>,
    onError: (error: Error) => void,
    writers: Array<Promise<void>>,
  ) {
    const project = await ProjectManager.getActiveProject()
    const workerController = Recorder.getWritingWorkerController()
    const unusedAddModuleResult = audioContext.audioWorklet.addModule('./assets/recordingAudioWorklet.js')
    const videoSession =
      videoInputs.length > 0
        ? new VideoRecordingSession(audioContext, project, (tracks) => Recorder.showRecordedVideo(tracks), onError)
        : null
    videoSession?.start()
    if (videoSession) writers.push(videoSession.settled)
    const unpairedVideoInputs = new Map(videoInputs.map((videoInput) => [videoInput.id, videoInput]))
    const inputs = []
    const audioWorkletNodes = []
    let trackIndex = 0
    for (const audioInput of audioInputs) {
      const track = await ProjectManager.addClipWithTrack(
        'Recording: ' + audioInput.name,
        audioInput.channelCount,
        0,
        AudioControl.startPosition,
        trackIndex++,
      )
      const clipView = track.clipViews[0]!
      const ringBufferArray = RingBuffer.getStorageForCapacity(64 * 1024, Float32Array)
      const overrunSampleCount = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
      inputs.push({
        dirname: project.directoryName,
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

      const videoInput = unpairedVideoInputs.get(audioInput.id)
      if (videoInput) {
        unpairedVideoInputs.delete(audioInput.id)
        await videoSession!.add(videoInput, clipView.clip, track)
      }
    }
    for (const videoInput of unpairedVideoInputs.values()) {
      const track = await ProjectManager.addClipWithTrack(
        'Recording: ' + videoInput.name,
        1,
        0,
        AudioControl.startPosition,
        trackIndex++,
      )
      const clip = track.clipViews[0]!.clip
      clip.audioPresent = false
      await videoSession!.add(videoInput, clip, track)
    }

    if (audioWorkletNodes.length == 0) {
      if (!videoSession) {
        audioContext.close()
        return
      }
      // No audio writer resumes the context once it is ready, and the video clock is its sample position.
      await audioContext.resume()
      return
    }
    workerController.setAudioWorkletNodes(audioWorkletNodes, onError)
    const audioWritten = workerController.start(JobType.RECORDER, inputs)
    Recorder.audioWriting = audioWritten
    writers.push(audioWritten)
    // Stop pressed while connecting: the context closed before setAudioWorkletNodes listened for it.
    if (audioContext.state == 'closed') workerController.worker.postMessage({ type: 'stop' })
  }

  private static showRecordedVideo(tracks: Array<Track>) {
    const trackListController = (window as RecorderWindow).trackListController
    trackListController.draw()
    if (tracks.length > 0) {
      void trackListController.revealTrack(tracks[0]).catch((error) => {
        NotificationsController.showError(error instanceof Error ? error : new Error(String(error)))
      })
    }
  }

  static async createFromUrl(url: string): Promise<Track | null> {
    const abortController = new AbortController()
    ;(window as RecorderWindow).processingModalController?.show('Downloading media...', () => abortController.abort())

    try {
      const importedFile = await NetworkUtils.downloadFile(
        url,
        Recorder.filenameFromUrl(url),
        (progress) => (window as RecorderWindow).processingModalController?.setProgress(progress),
        abortController.signal,
      )
      ;(window as RecorderWindow).processingModalController?.setTitle('Importing media...')
      ;(window as RecorderWindow).processingModalController?.setProgress(0)
      return await Recorder.createFromSourceFile(importedFile, abortController.signal)
    } catch (error) {
      if (isAbortError(error)) {
        Recorder.showImportCanceledNotification()
        return null
      }
      NotificationsController.showErrorMessage(error instanceof Error ? error.message : String(error))
      throw error
    } finally {
      ;(window as RecorderWindow).processingModalController?.hide()
    }
  }

  static async createFromFile(file: File): Promise<Track | null> {
    const abortController = new AbortController()
    ;(window as RecorderWindow).processingModalController?.show('Importing media...', () => abortController.abort())

    try {
      return await Recorder.createFromSourceFile(file, abortController.signal)
    } catch (error) {
      if (isAbortError(error)) {
        Recorder.showImportCanceledNotification()
        return null
      }
      NotificationsController.showErrorMessage(error instanceof Error ? error.message : String(error))
      throw error
    } finally {
      ;(window as RecorderWindow).processingModalController?.hide()
    }
  }

  private static async createFromSourceFile(file: File, signal?: AbortSignal): Promise<Track> {
    const track = await MediaImporter.importFile(file, {
      signal,
      onProgress: (progress) => (window as RecorderWindow).processingModalController?.setProgress(progress),
    })
    ;(window as RecorderWindow).trackListController.draw()
    if (track.clipViews.some((view) => view.clip.videoSegments.length > 0)) {
      await (window as RecorderWindow).trackListController.revealTrack(track)
    }
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
    NotificationsController.showShortDurationMessage('Media import canceled.')
  }
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}
