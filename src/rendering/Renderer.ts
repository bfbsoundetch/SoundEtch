import { Project } from '../project/Project'
import { Track } from '../project/Track'
import { WorkerController } from '../audiocontext/WorkerController'
import { ClipViewSubset } from '../playback/AudioFileReader'
import { ProjectManager } from '../project/ProjectManager'
import { EncoderInfo } from '../encoders/EncoderType'
import { RenderingArgument, RenderingEncodingInitMessage, RenderingWorkerStartMessage } from './RenderingWorkerProtocol'
import { SelectedRegion } from 'playback/Player'

export class Renderer {
  private static readingWorkerController: WorkerController | null = null
  private static renderingWorker: Worker | null = null
  private static cancelRenderingCallback: (() => void) | null = null

  static async exportProject(encoderInfo: EncoderInfo, selectedRegion: SelectedRegion | null) {
    const project = await ProjectManager.getActiveProject()
    const projectLength = selectedRegion ? selectedRegion.endSample - selectedRegion.startSample : project.getTracks().reduce((maxLength, track) => Math.max(maxLength, track.length), 0)
    const exportInfo = encoderInfo.encoder === 'wav' ? { ...encoderInfo, sampleCount: projectLength } : encoderInfo
    const file = await showSaveFilePicker({
      startIn: 'downloads',
      suggestedName: `${project.title}.${exportInfo.encoder}`,
    } as any)

    return Renderer.render(file, 1, project, exportInfo, selectedRegion?.startSample ?? 0, projectLength, ...project.getTracks())
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
    const argument: RenderingArgument = {
      file: file,
      projectId: project.id!,
      sampleRate: project.sampleRate,
      channelCount: outputChannelCount,
      startPosition: startPosition,
      length: projectLength,
      encoderInfo,
      trackSubsets: tracks.map((track) => {
        return {
          name: track.name,
          length: track.length,
          channelCount: track.getChannelCount(),
          clipViews: track.clipViews.map((clipView) => {
            return {
              startPosition: clipView.startPosition,
              offset: clipView.offset,
              length: clipView.length,
              clip: {
                id: clipView.clip.id!,
                channelCount: clipView.clip.getChannelCount(),
              },
            }
          }),
          effects: [],
          gain: track.getGain(),
          pan: track.getPan(),
        }
      }),
    }

    const renderingWorker = new Worker('./assets/renderingWorker.js', { type: 'module' })
    const encodingWorker = new Worker(new URL('./RenderingEncodingWorker.ts', import.meta.url), { type: 'module' })
    const encodingChannel = new MessageChannel()
    Renderer.renderingWorker = renderingWorker

    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        Renderer.cancelRenderingCallback = null
        Renderer.renderingWorker = null
        renderingWorker.terminate()
        encodingWorker.terminate()
      }

      Renderer.cancelRenderingCallback = () => {
        cleanup()
        reject(new Error('Render canceled'))
      }

      const rejectWithCleanup = (error: unknown) => {
        cleanup()
        reject(error)
      }

      encodingWorker.onmessage = (e) => {
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
      encodingWorker.onerror = (error) => rejectWithCleanup(error)
      renderingWorker.onmessageerror = (error) => rejectWithCleanup(error)
      encodingWorker.onmessageerror = (error) => rejectWithCleanup(error)

      const encodingInitMessage: RenderingEncodingInitMessage = {
        type: 'init',
        file,
        encoderInfo,
        channelCount: outputChannelCount,
        encodingPort: encodingChannel.port1,
        length: projectLength
      }
      encodingWorker.postMessage(encodingInitMessage, [encodingChannel.port1])

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
