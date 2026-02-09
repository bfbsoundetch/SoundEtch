import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import { ControllableWorkerJob } from '../audiocontext/ControllableWorkerJob'
import { AudioFileWriter } from './AudioFileWriter'
import { Summary } from '../project/Summary'

export class AudioFileWritingJob implements ControllableWorkerJob {
  private constructor(private readonly audioFileWriters = new Array<AudioFileWriter>()) {}

  static async create(argument: any): Promise<AudioFileWritingJob> {
    const audioFileWriters = new Array<AudioFileWriter>()

    for (const input of argument) {
      const fileHandle = await FileSystemUtils.getFileHandle(input.dirname, input.clip.filename)
      const summaryFileHandle = await FileSystemUtils.getFileHandle(input.dirname, `${input.clip.filename}_summary`)
      const fileSyncHandle = await (fileHandle as any).createSyncAccessHandle()
      const summary = new Summary(0)
      Object.keys(input.clip.summary).forEach((key) => ((summary as any)[key] = input.clip.summary[key]))
      summary.setSyncFileHandle(await (summaryFileHandle as any).createSyncAccessHandle())
      audioFileWriters.push(new AudioFileWriter(fileSyncHandle, summary, input.ringBufferArray))
    }
    return new AudioFileWritingJob(audioFileWriters)
  }

  async start(): Promise<any> {
    postMessage({ type: 'ready' })
    await Promise.allSettled(this.audioFileWriters.map((writer) => writer.runFileWritingLoop()))
  }
  pause(): void {
    this.audioFileWriters.forEach((w) => w.pause())
  }
  resume(): void {
    this.audioFileWriters.forEach((w) => w.resume())
  }
  stop(): void {
    this.audioFileWriters.forEach((w) => w.stop())
  }
}
