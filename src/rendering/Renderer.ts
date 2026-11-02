import { Project } from '../project/Project'
import { Track } from '../project/Track'
import { WorkerController } from '../audiocontext/WorkerController'
import { ClipViewSubset } from '../playback/AudioFileReader'
import { ProjectManager } from '../project/ProjectManager'
import { EncoderInfo } from '../encoders/EncoderType'
import {
  LoudnessMeasuringInitMessage,
  LoudnessNormalizingStartMessage,
  RenderingArgument,
  RenderingEncodingInitMessage,
  RenderingFileWritingInitMessage,
  RenderingOutputWorkerMessage,
  RenderingWorkerStartMessage,
} from './RenderingWorkerProtocol'
import type { SelectedRegion } from 'playback/Player'
import { createRenderingArgument } from './RenderingArgumentFactory'
import { Clip } from '../project/Clip'
import { cloneWithGetters } from '../global/ObjectUtils'
import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import type { ProcessingModalController } from '../ui/ProcessingModalController'

const EXPORT_TRUE_PEAK_CEILING_DB = -1
// Sits beside the numeric project directories in the OPFS root, so it can never collide with one.
const EXPORT_TEMP_DIRECTORY = 'export-temp'
const STALE_EXPORT_TEMP_FILE_AGE_MS = 24 * 60 * 60 * 1000
// A terminated worker's sync access handle lock is released asynchronously.
const LOCKED_TEMP_FILE_DELETE_RETRIES = 5
const LOCKED_TEMP_FILE_DELETE_RETRY_MS = 100

interface ProcessingModalWindow extends Window {
  readonly processingModalController?: ProcessingModalController
}

// A worker that produces interleaved audio on an encoding port (RenderingJob or LoudnessNormalizingWorker).
export type AudioSourceWorker = {
  worker: Worker
  startMessage:
    Omit<RenderingWorkerStartMessage, 'encodingPort'> | Omit<LoudnessNormalizingStartMessage, 'encodingPort'>
}

export class Renderer {
  private static readingWorkerController: WorkerController | null = null
  private static cancelRenderingCallback: (() => void) | null = null

  static async exportProject(
    encoderInfo: EncoderInfo,
    selectedRegion: SelectedRegion | null,
    loudnessTargetLufs: number | null,
  ) {
    const project = await ProjectManager.getActiveProject()
    const projectLength = selectedRegion
      ? selectedRegion.endSample - selectedRegion.startSample
      : project.getTracks().reduce((maxLength, track) => Math.max(maxLength, track.length), 0)
    const exportInfo = encoderInfo.encoder === 'wav' ? { ...encoderInfo, sampleCount: projectLength } : encoderInfo
    const tracks = selectedRegion?.tracks ?? project.getTracks()
    const file = await showSaveFilePicker({
      startIn: 'downloads',
      suggestedName: `${project.title}.${exportInfo.encoder}`,
    } as any)
    const argument = createRenderingArgument(
      project,
      exportInfo.channelCount,
      selectedRegion?.startSample ?? 0,
      projectLength,
      tracks,
      project.outputEffects,
    )

    const encode = (createSource: () => AudioSourceWorker) =>
      Renderer.encode(file, exportInfo, projectLength, createSource)

    if (loudnessTargetLufs === null) {
      return encode(() => Renderer.createRenderingSource(argument))
    }
    return Renderer.withLoudnessNormalizedSource(argument, loudnessTargetLufs, 'Publishing project...', encode)
  }

  static createRenderingSource(argument: RenderingArgument): AudioSourceWorker {
    return { worker: new Worker('./assets/renderingWorker.js', { type: 'module' }), startMessage: { argument } }
  }

  // Pass 1 renders the mix once into an OPFS temp file while measuring its integrated loudness. consume then
  // runs its pipeline from a source that streams the temp file back through the normalization gain and a
  // true-peak limiter. The temp file is deleted when consume settles, including on cancel and error.
  static async withLoudnessNormalizedSource<T>(
    argument: RenderingArgument,
    loudnessTargetLufs: number,
    publishingTitle: string,
    consume: (createSource: () => AudioSourceWorker) => Promise<T>,
  ): Promise<T> {
    const tempFile = { dirname: EXPORT_TEMP_DIRECTORY, filename: crypto.randomUUID() }
    const modal = (window as ProcessingModalWindow).processingModalController

    try {
      modal?.setTitle('Measuring loudness...')
      modal?.setProgress(0)
      const { integratedLufs } = await Renderer.runPipeline(
        Renderer.createRenderingSource(argument),
        new Worker(new URL('./LoudnessMeasuringWorker.ts', import.meta.url), { type: 'module' }),
        {
          type: 'init',
          ...tempFile,
          sampleRate: argument.sampleRate,
          channelCount: argument.channelCount,
          length: argument.length,
        },
      )
      if (integratedLufs === undefined) {
        throw new Error('Loudness measurement returned no result')
      }

      let gain = 1
      if (Number.isFinite(integratedLufs)) {
        gain = 10 ** ((loudnessTargetLufs - integratedLufs) / 20)
      } else {
        console.warn('Loudness normalization skipped: the export is silent')
      }

      modal?.setTitle(publishingTitle)
      modal?.setProgress(0)
      // No I/O await between pass 1 resolving and consume starting its pipeline: a cancel click is a
      // macrotask, so it always reaches one of the two pipelines.
      return await consume(() => ({
        worker: new Worker(new URL('./LoudnessNormalizingWorker.ts', import.meta.url), { type: 'module' }),
        startMessage: {
          ...tempFile,
          sampleRate: argument.sampleRate,
          channelCount: argument.channelCount,
          length: argument.length,
          gain,
          truePeakCeilingDb: EXPORT_TRUE_PEAK_CEILING_DB,
        },
      }))
    } finally {
      await Renderer.deleteExportTempFiles(tempFile)
    }
  }

  private static async deleteExportTempFiles(tempFile: { dirname: string; filename: string }) {
    for (let retry = 0; ; ++retry) {
      try {
        await FileSystemUtils.deleteFile(tempFile.dirname, tempFile.filename)
        break
      } catch (error) {
        const locked = error instanceof DOMException && error.name === 'NoModificationAllowedError'
        if (!locked || retry === LOCKED_TEMP_FILE_DELETE_RETRIES) {
          console.warn('Could not delete export temp file', error)
          break
        }
        const { promise, resolve } = Promise.withResolvers<void>()
        setTimeout(resolve, LOCKED_TEMP_FILE_DELETE_RETRY_MS)
        await promise
      }
    }

    // Leftovers from exports interrupted by a crash or a closed tab.
    try {
      for (const file of await FileSystemUtils.getDirectoryFiles(EXPORT_TEMP_DIRECTORY)) {
        if (file.data instanceof File && Date.now() - file.data.lastModified > STALE_EXPORT_TEMP_FILE_AGE_MS) {
          await FileSystemUtils.deleteFile(EXPORT_TEMP_DIRECTORY, file.path)
        }
      }
    } catch (error) {
      console.warn('Could not remove stale export temp files', error)
    }
  }

  private static async encode(
    file: FileSystemFileHandle,
    encoderInfo: EncoderInfo,
    length: number,
    createSource: () => AudioSourceWorker,
  ) {
    const encodingWorker = new Worker(new URL('./RenderingEncodingWorker.ts', import.meta.url), { type: 'module' })
    await Renderer.runPipeline(createSource(), encodingWorker, {
      type: 'init',
      file,
      encoderInfo,
      channelCount: encoderInfo.channelCount,
      length,
    })
  }

  static async renderToClip(
    project: Project,
    clip: Clip,
    startPosition: number,
    length: number,
    ...tracks: Array<Track>
  ) {
    const channelCount = clip.getChannelCount()
    // The frozen clip plays on a track, so the output chain still processes it later.
    const argument = createRenderingArgument(project, channelCount, startPosition, length, tracks, [])
    const writingWorker = new Worker(new URL('./RenderingFileWritingWorker.ts', import.meta.url), { type: 'module' })
    writingWorker.addEventListener('message', clip.summary.getWorkerMessageListener())
    const writingInitMessage: Omit<RenderingFileWritingInitMessage, 'encodingPort'> = {
      type: 'init',
      dirname: project.directoryName,
      clip: cloneWithGetters(clip),
      channelCount,
      length,
    }
    await Renderer.runPipeline(Renderer.createRenderingSource(argument), writingWorker, writingInitMessage)
  }

  // Connects source → output worker over a MessageChannel and resolves with the output worker's done message.
  private static async runPipeline(
    source: AudioSourceWorker,
    outputWorker: Worker,
    outputInitMessage:
      | Omit<RenderingEncodingInitMessage, 'encodingPort'>
      | Omit<RenderingFileWritingInitMessage, 'encodingPort'>
      | Omit<LoudnessMeasuringInitMessage, 'encodingPort'>,
  ): Promise<RenderingOutputWorkerMessage> {
    const encodingChannel = new MessageChannel()
    const { promise, resolve, reject } = Promise.withResolvers<RenderingOutputWorkerMessage>()

    const cleanup = () => {
      Renderer.cancelRenderingCallback = null
      source.worker.terminate()
      outputWorker.terminate()
    }

    Renderer.cancelRenderingCallback = () => {
      cleanup()
      reject(new Error('Render canceled'))
    }

    const rejectWithCleanup = (error: unknown) => {
      cleanup()
      reject(error)
    }

    outputWorker.onmessage = (e: MessageEvent<RenderingOutputWorkerMessage>) => {
      if (e.data.error) {
        rejectWithCleanup(new Error(String(e.data.error)))
        return
      }
      if (e.data.done) {
        cleanup()
        resolve(e.data)
      }
      const progress = e.data.progress
      if (typeof progress === 'number') {
        ;(window as ProcessingModalWindow).processingModalController?.setProgress(progress)
      }
    }
    source.worker.onmessage = (e: MessageEvent<RenderingOutputWorkerMessage | undefined>) => {
      if (e.data?.error) {
        rejectWithCleanup(new Error(String(e.data.error)))
      }
    }

    source.worker.onerror = (error) => rejectWithCleanup(error)
    outputWorker.onerror = (error) => rejectWithCleanup(error)
    source.worker.onmessageerror = (error) => rejectWithCleanup(error)
    outputWorker.onmessageerror = (error) => rejectWithCleanup(error)

    outputWorker.postMessage({ ...outputInitMessage, encodingPort: encodingChannel.port1 }, [encodingChannel.port1])
    source.worker.postMessage({ ...source.startMessage, encodingPort: encodingChannel.port2 }, [encodingChannel.port2])
    return await promise
  }

  static cancelRender() {
    Renderer.cancelRenderingCallback?.()
  }

  static getReadingWorkerController(): WorkerController {
    if (Renderer.readingWorkerController) {
      return Renderer.readingWorkerController
    }
    return (Renderer.readingWorkerController = new WorkerController())
  }
}

interface RenderInfo {
  clipViews: Array<ClipViewSubset>
  ringBufferArray: SharedArrayBuffer
}
