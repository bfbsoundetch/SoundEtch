import { MemoryBackedFileSystemSyncAccessHandle } from './MemoryBackedFileSystemSyncAccessHandle'

export class MemoryBackedFileSystem {
  private static files = new Map<string, MemoryBackedFileSystemSyncAccessHandle>()

  static getFileHandle(dirName: string, fileName: string): MemoryBackedFileSystemSyncAccessHandle {
    const path = `${dirName}/${fileName}`
    const existing = MemoryBackedFileSystem.files.get(path)
    if (existing) {
      return existing
    }
    const newFile = new MemoryBackedFileSystemSyncAccessHandle(path)
    MemoryBackedFileSystem.files.set(path, newFile)
    return newFile
  }

  static deleteFile(dirName: string, fileName: string) {
    const path = `${dirName}/${fileName}`
    MemoryBackedFileSystem.files.delete(path)
  }
}
