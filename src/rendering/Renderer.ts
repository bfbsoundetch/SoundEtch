import { Project } from '../project/Project'
import { Track } from '../project/Track'
import { WorkerController } from '../audiocontext/WorkerController'
import { ClipViewSubset } from '../playback/AudioFileReader'
import { ProjectManager } from '../project/ProjectManager'
import { EncoderInfo } from '../encoders/EncoderType'
import {
  RenderingEncodingInitMessage,
  RenderingFileWritingInitMessage,
  RenderingWorkerStartMessage,
} from './RenderingWorkerProtocol'
import { SelectedRegion } from 'playback/Player'
import { createRenderingArgument } from './RenderingArgumentFactory'
import { Clip } from '../project/Clip'
import { cloneWithGetters } from '../global/ObjectUtils'

export class Renderer {
  private static readingWorkerController: WorkerController | null = null
  private static renderingWorker: Worker | null = null
  private static cancelRenderingCallback: (() => void) | null = null

  static async exportProject(encoderInfo: EncoderInfo, selectedRegion: SelectedRegion | null) {
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

    return Renderer.render(
      file,
      exportInfo.channelCount,
      project,
      exportInfo,
      selectedRegion?.startSample ?? 0,
      projectLength,
      ...tracks,
    )
  }

  static async render(
    file: FileSystemFileHandle,
    outputChannelCount: number,
    project: Project,
    encoderInfo: EncoderInfo,
    startPosition: number,
    projectLength: number,
    ...tracks: Array<Track>
  ) {
    const argument = createRenderingArgument(project, outputChannelCount, startPosition, projectLength, tracks)
    const encodingWorker = new Worker(new URL('./RenderingEncodingWorker.ts', import.meta.url), { type: 'module' })

    const encodingInitMessage: Omit<RenderingEncodingInitMessage, 'encodingPort'> = {
      type: 'init',
      file,
      encoderInfo,
      channelCount: outputChannelCount,
      length: projectLength,
    }
    await Renderer.runRender(argument, encodingWorker, encodingInitMessage)
  }

  static async renderToClip(
    project: Project,
    clip: Clip,
    startPosition: number,
    length: number,
    ...tracks: Array<Track>
  ) {
    const channelCount = clip.getChannelCount()
    const argument = createRenderingArgument(project, channelCount, startPosition, length, tracks)
    const writingWorker = new Worker(new URL('./RenderingFileWritingWorker.ts', import.meta.url), { type: 'module' })
    writingWorker.addEventListener('message', clip.summary.getWorkerMessageListener())
    const writingInitMessage: Omit<RenderingFileWritingInitMessage, 'encodingPort'> = {
      type: 'init',
      dirname: project.directoryName,
      clip: cloneWithGetters(clip),
      channelCount,
      length,
    }
    await Renderer.runRender(argument, writingWorker, writingInitMessage)
  }

  private static async runRender(
    argument: ReturnType<typeof createRenderingArgument>,
    outputWorker: Worker,
    outputInitMessage:
      Omit<RenderingEncodingInitMessage, 'encodingPort'> | Omit<RenderingFileWritingInitMessage, 'encodingPort'>,
  ) {
    const renderingWorker = new Worker('./assets/renderingWorker.js', { type: 'module' })
    const encodingChannel = new MessageChannel()
    Renderer.renderingWorker = renderingWorker

    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        Renderer.cancelRenderingCallback = null
        Renderer.renderingWorker = null
        renderingWorker.terminate()
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

      outputWorker.onmessage = (e) => {
        if (e.data.error) {
          rejectWithCleanup(new Error(String(e.data.error)))
          return
        }
        if (e.data.done) {
          cleanup()
          resolve()
        }
        const progress = e.data.progress
        if (typeof progress === 'number') {
          ;(window as any).processingModalController?.setProgress(progress)
        }
      }

      renderingWorker.onerror = (error) => rejectWithCleanup(error)
      outputWorker.onerror = (error) => rejectWithCleanup(error)
      renderingWorker.onmessageerror = (error) => rejectWithCleanup(error)
      outputWorker.onmessageerror = (error) => rejectWithCleanup(error)

      const encodingInitMessage = {
        ...outputInitMessage,
        encodingPort: encodingChannel.port1,
      }
      outputWorker.postMessage(encodingInitMessage, [encodingChannel.port1])

      const renderingStartMessage: RenderingWorkerStartMessage = {
        argument,
        encodingPort: encodingChannel.port2,
      }
      renderingWorker.postMessage(renderingStartMessage, [encodingChannel.port2])
    })
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
