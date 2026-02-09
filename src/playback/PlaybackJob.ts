import { ControllableWorkerJob } from '../audiocontext/ControllableWorkerJob'
import { AudioFileReader } from './AudioFileReader'

export class PlaybackJob implements ControllableWorkerJob {
  private readonly audioFileReaders: Array<AudioFileReader>

  constructor(argument: any) {
    this.audioFileReaders = argument.playbackInfos.map(
      (playbackInfo: any) =>
        new AudioFileReader(
          argument.projectName,
          argument.position,
          playbackInfo.clipViews,
          argument.sampleRate,
          playbackInfo.ringBufferArray,
        ),
    )
  }

  async start(): Promise<any> {
    const completionPromise = Promise.all(this.audioFileReaders.map((r) => r.runBufferFillingLoop()))
    const readyPromise = Promise.all(this.audioFileReaders.map((r) => r.readyPromise))
    await readyPromise
    postMessage({ type: 'ready' })
    await completionPromise
  }
  pause(): void {
    this.audioFileReaders.forEach((r) => r.pause())
  }
  resume(): void {
    this.audioFileReaders.forEach((r) => r.resume())
  }
  stop(): void {
    this.audioFileReaders.forEach((r) => r.stop())
  }
}
