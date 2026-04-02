import { RingBuffer } from 'ringbuf.js'
import { Project } from '../project/Project'
import { Track } from '../project/Track'
import { JobType } from '../audiocontext/ControllableWorkerJob'
import { WorkerController } from '../audiocontext/WorkerController'
import { cloneWithGetters } from '../global/ObjectUtils'
import { ClipViewSubset } from '../playback/AudioFileReader'
import { AudioFilePublishingJobArgument } from './AudioFilePublishingJob'
import { ProjectManager } from '../project/ProjectManager'
import { encoderInforWritableStreamFactory, encoderInfoTransformerFactory, Mp3EncoderInfo, OpusEncoderInfo, WavEncoderInfo } from '../encoders/EncoderType'
import { RenderingArgument } from './RenderingJob'
import { Mp3OutputSampleRate } from 'encoders/Mp3Transformer'

export class Renderer {
  private static readingWorkerController: WorkerController | null = null
  private static renderingWorker: Worker | null = null
  private static cancelRenderingCallback: (() => void) | null = null

  static async exportProject() {
    const project = await ProjectManager.getActiveProject()
    try {
      const file = await showSaveFilePicker({
        startIn: 'downloads',
        suggestedName: `${project.title}.mp3`,
      } as any)

      ;(window as any).processingModalController?.show('Exporting project...', () => Renderer.cancelRender())
      await Renderer.renderNew(file, 1, project, 0, ...project.getTracks())
      ;(window as any).processingModalController?.hide()
    } catch {
      ;(window as any).processingModalController?.hide()
    }
  }

  static async renderNew(
    file: FileSystemFileHandle,
    outputChannelCount: number,
    project: Project,
    startPosition: number,
    ...tracks: Array<Track>
  ) {
    const encoding: Mp3EncoderInfo = {
      encoder: 'mp3',
      sampleRate: project.sampleRate as Mp3OutputSampleRate,
      channelCount: outputChannelCount,
      bitrate: 64000,
      vbrQuality: undefined,
    }
    // const encoding: WavEncoderInfo = {
    //   encoder: 'wav',
    //   sampleRate: project.sampleRate,
    //   channelCount: outputChannelCount,
    //   sampleFormat: 'int16',
    //   sampleCount: Math.max(...tracks.map(t => t.length))
    // }

    const argument: RenderingArgument = {
      file: file,
      projectId: project.id!,
      sampleRate: project.sampleRate,
      channelCount: outputChannelCount,
      startPosition: startPosition,
      encoderInfo: encoding,
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

  static async render(
    outputFileStream: FileSystemWritableFileStream,
    outputChannelCount: number,
    project: Project,
    startPosition: number,
    ...tracks: Array<Track>
  ) {
    const length = tracks.reduce((m, t) => Math.max(m, t.length), 0) * outputChannelCount
    const audioContext = new OfflineAudioContext({
      sampleRate: project.sampleRate,
      length: 1024,
    })
    if (tracks.length == 0) {
      return
    }
    await Promise.all([
      audioContext.audioWorklet.addModule('./assets/renderingAudioWorklet.js'),
      audioContext.audioWorklet.addModule(new URL('./WritingRenderAudioWorkletProcessor.js', import.meta.url)),
    ])
    const workerController = Renderer.getReadingWorkerController()

    const renderInfos = new Array<RenderInfo>()
    const playerNodes = new Array<AudioWorkletNode>()

    // const encoding: WavEncoderInfo = {
    //   encoder: 'wav',
    //   sampleRate: project.sampleRate,
    //   channelCount: outputChannelCount,
    //   sampleFormat: 'float32',
    // }
    const encoding: Mp3EncoderInfo = {
      encoder: 'mp3',
      sampleRate: 48000,
      channelCount: 1,
      bitrate: 128,
      vbrQuality: undefined,
    }
    const transformStream = await encoderInfoTransformerFactory(length, encoding)
    transformStream?.readable.pipeTo(outputFileStream)
    const writableStream = transformStream?.writable ?? outputFileStream

    const recordingWorkletNode = new AudioWorkletNode(audioContext, 'WritingRenderAudioWorkletProcessor', {
      processorOptions: {
        channelCount: outputChannelCount,
      },
    })

    recordingWorkletNode.port.postMessage({ writableStream: writableStream }, [writableStream])

    tracks.forEach((track) => {
      console.error(track.name)
      const readingRingBufferArray = RingBuffer.getStorageForCapacity(32 * 1024, Float32Array)

      const playerNode = new AudioWorkletNode(audioContext, 'readingRenderProcessor', {
        processorOptions: {
          length: track.length,
          ringBufferArray: readingRingBufferArray,
          startPosition: startPosition,
        },
        outputChannelCount: [track.getChannelCount()],
        channelCountMode: 'explicit',
      })
      const gainNode = audioContext.createGain()
      gainNode.channelCount = outputChannelCount
      gainNode.channelCountMode = 'explicit'
      gainNode.channelInterpretation = 'speakers'
      gainNode.gain.value = track.getGain()

      playerNode.connect(gainNode)

      if (outputChannelCount == 1) {
        gainNode.connect(recordingWorkletNode)
      } else {
        const pannerNode = audioContext.createStereoPanner()
        pannerNode.pan.value = track.getPan()
        gainNode.connect(pannerNode)
        pannerNode.connect(recordingWorkletNode)
      }

      renderInfos.push({
        clipViews: track.clipViews.map((c) => {
          const result = cloneWithGetters(c)
          delete result.clip.summary
          return result
        }),
        ringBufferArray: readingRingBufferArray,
      })
      playerNodes.push(playerNode)
    })
    if (playerNodes.length == 0) {
      return
    }
    // const workerArgument: AudioFilePublishingJobArgument = {
    //   length: length,
    //   writableStream: writableStream,
    //   ringBufferArray: writingRingBufferArray
    // }
    // workerController.start(JobType.PUBLISHER, workerArgument, [writableStream])
    workerController.setAudioWorkletNode(playerNodes)
    workerController.start(JobType.PLAYER, {
      projectName: `${project.id}`,
      position: startPosition,
      sampleRate: audioContext.sampleRate,
      playbackInfos: renderInfos,
    })
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
