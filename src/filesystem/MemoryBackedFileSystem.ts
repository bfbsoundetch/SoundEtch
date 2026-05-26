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

  static deleteDirectory(dirName: string) {
    const prefix = `${dirName}/`
    for (const path of MemoryBackedFileSystem.files.keys()) {
      if (path.startsWith(prefix)) {
        MemoryBackedFileSystem.files.delete(path)
      }
    }
  }

  static getDirectorySize(dirName: string): number {
    const prefix = `${dirName}/`
    let size = 0
    for (const [path, file] of MemoryBackedFileSystem.files) {
      if (path.startsWith(prefix)) {
        size += file.getSize()
      }
    }
    return size
  }
}
