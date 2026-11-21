import type { FileSystemSyncAccessHandle } from '../filesystem/FileSystemSyncAccessHandle'
import type { Summary } from '../project/Summary'

/** A clip's audio file while a recording writes it; only the writing worker's own code may use these handles. */
export interface LiveRecordingFile {
  readonly handle: FileSystemSyncAccessHandle
  readonly summaryHandle: FileSystemSyncAccessHandle
  readonly summary: Summary
  /** Frames already in the file and in `summary`. */
  writtenFrames(): number
}

const files = new Map<string, LiveRecordingFile>()

/**
 * The writing worker's recordings by `${dirname}/${filename}`. A recording holds the only writable handles on its
 * files, so the high-quality patch service borrows them instead of opening the files itself.
 */
export class LiveRecordingFiles {
  static register(key: string, file: LiveRecordingFile): void {
    files.set(key, file)
  }

  static get(key: string): LiveRecordingFile | null {
    return files.get(key) ?? null
  }

  static unregister(key: string): void {
    files.delete(key)
  }
}
