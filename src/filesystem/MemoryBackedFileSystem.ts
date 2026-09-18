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

  static replaceFileHandle(dirName: string, fileName: string): MemoryBackedFileSystemSyncAccessHandle {
    const path = `${dirName}/${fileName}`
    const file = new MemoryBackedFileSystemSyncAccessHandle(path)
    MemoryBackedFileSystem.files.set(path, file)
    return file
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

  static getDirectoryFiles(dirName: string): Array<{ path: string; data: Blob }> {
    const prefix = `${dirName}/`
    const result = new Array<{ path: string; data: Blob }>()
    for (const [path, file] of MemoryBackedFileSystem.files) {
      if (path.startsWith(prefix)) {
        result.push({ path: path.slice(prefix.length), data: file.toBlob() })
      }
    }
    return result
  }
}
