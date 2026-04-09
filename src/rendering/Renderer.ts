import { Project } from '../project/Project'
import { Track } from '../project/Track'
import { WorkerController } from '../audiocontext/WorkerController'
import { ClipViewSubset } from '../playback/AudioFileReader'
import { ProjectManager } from '../project/ProjectManager'
import {
  EncoderInfo,
} from '../encoders/EncoderType'
import { RenderingArgument } from './RenderingJob'

export class Renderer {
  private static readingWorkerController: WorkerController | null = null
  private static renderingWorker: Worker | null = null
  private static cancelRenderingCallback: (() => void) | null = null

  static async exportProject(encoderInfo: EncoderInfo) {
    const project = await ProjectManager.getActiveProject()
    const trackLength = project.getTracks().reduce((maxLength, track) => Math.max(maxLength, track.length), 0)
    const exportInfo = encoderInfo.encoder === 'wav' ? { ...encoderInfo, sampleCount: trackLength } : encoderInfo
    try {
      const file = await showSaveFilePicker({
        startIn: 'downloads',
        suggestedName: `${project.title}.${exportInfo.encoder}`,
      } as any)

      ;(window as any).processingModalController?.show('Exporting project...', () => Renderer.cancelRender())
      await Renderer.renderNew(file, 1, project, exportInfo, 0, ...project.getTracks())
      ;(window as any).processingModalController?.hide()
    } catch {
      ;(window as any).processingModalController?.hide()
    }
  }

  static async renderNew(
    file: FileSystemFileHandle,
    outputChannelCount: number,
    project: Project,
    encoderInfo: EncoderInfo,
    startPosition: number,
    ...tracks: Array<Track>
  ) {
    const argument: RenderingArgument = {
      file: file,
      projectId: project.id!,
      sampleRate: project.sampleRate,
      channelCount: outputChannelCount,
      startPosition: startPosition,
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

    const worker = new Worker('./assets/renderingWorker.js', { type: 'module' })
    Renderer.renderingWorker = worker

    await new Promise<void>((resolve, reject) => {
      Renderer.cancelRenderingCallback = () => {
        worker.terminate()
        Renderer.cancelRenderingCallback = null
        Renderer.renderingWorker = null
        reject(new Error('Render canceled'))
      }
      worker.onmessage = (e) => {
        const progress = e.data.progress
        if (typeof progress === 'number') {
          ;(window as any).processingModalController?.setProgress(progress)
        }
        if (e.data.done) {
          Renderer.cancelRenderingCallback = null
          Renderer.renderingWorker = null
          resolve()
        }
      }
      worker.onerror = (error) => {
        Renderer.cancelRenderingCallback = null
        Renderer.renderingWorker = null
        reject(error)
      }

      worker.postMessage(argument)
    }).finally(() => {
      worker.terminate()
      Renderer.cancelRenderingCallback = null
      Renderer.renderingWorker = null
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
