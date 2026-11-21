import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import { ControllableWorkerJob } from '../audiocontext/ControllableWorkerJob'
import { AudioFileWriter } from './AudioFileWriter'
import { Summary } from '../project/Summary'
import { FileSystemSyncAccessHandle } from '../filesystem/FileSystemSyncAccessHandle'
import { LiveRecordingFiles } from './LiveRecordingFiles'

interface RecordingInput {
  readonly dirname: string
  readonly channelCount: number
  readonly clip: { readonly filename: string; readonly summary: Summary }
  readonly ringBufferArray: SharedArrayBuffer
  readonly overrunSampleCount: SharedArrayBuffer
}

export class AudioFileWritingJob implements ControllableWorkerJob {
  private constructor(private readonly audioFileWriters = new Array<AudioFileWriter>()) {}

  static async create(argument: readonly RecordingInput[]): Promise<AudioFileWritingJob> {
    const audioFileWriters = new Array<AudioFileWriter>()
    const acquiredHandles = new Array<FileSystemSyncAccessHandle>()
    const liveKeys = new Array<string>()
    try {
      for (const input of argument) {
        // The DOM types omit the worker-only sync access API.
        const fileHandle = (await FileSystemUtils.getFileHandle(
          input.dirname,
          input.clip.filename,
        )) as FileSystemFileHandle & {
          createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle>
        }
        const summaryFileHandle = (await FileSystemUtils.getFileHandle(
          input.dirname,
          `${input.clip.filename}_summary`,
        )) as FileSystemFileHandle & { createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle> }
        const fileSyncHandle = await fileHandle.createSyncAccessHandle()
        acquiredHandles.push(fileSyncHandle)
        const summary = new Summary(input.channelCount)
        Object.assign(summary, input.clip.summary)
        const summarySyncHandle = await summaryFileHandle.createSyncAccessHandle()
        acquiredHandles.push(summarySyncHandle)
        summary.setSyncFileHandle(summarySyncHandle)
        const liveKey = `${input.dirname}/${input.clip.filename}`
        audioFileWriters.push(
          new AudioFileWriter(
            fileSyncHandle,
            summary,
            input.ringBufferArray,
            input.overrunSampleCount,
            input.channelCount,
            { key: liveKey, summaryHandle: summarySyncHandle },
          ),
        )
        liveKeys.push(liveKey)
      }
      return new AudioFileWritingJob(audioFileWriters)
    } catch (error) {
      // These writers never run, so nothing else withdraws their handles before they close.
      liveKeys.forEach((key) => LiveRecordingFiles.unregister(key))
      for (const handle of acquiredHandles) {
        try {
          handle.close()
        } catch {
          // Keep the setup failure, but release every other acquired handle.
        }
      }
      throw error
    }
  }

  async start(onError?: (error: unknown) => void): Promise<void> {
    let failed = false
    let failure: unknown
    const reportFailure = (error: unknown) => {
      if (failed) return
      failed = true
      failure = error
      this.audioFileWriters.forEach((writer) => writer.stop(true))
      onError?.(error)
    }
    try {
      postMessage({ type: 'ready' })
    } catch (error) {
      reportFailure(error)
    }
    const results = await Promise.allSettled(
      this.audioFileWriters.map((writer) => writer.runFileWritingLoop(reportFailure)),
    )
    for (const result of results) {
      if (result.status === 'rejected') reportFailure(result.reason)
    }
    if (failed) throw failure
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
