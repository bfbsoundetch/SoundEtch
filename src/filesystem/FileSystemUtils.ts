import { GlobalSettings } from '../global/GlobalSettings'

export class FileSystemUtils {
  static async getOperatingSystemFileSystemFileHandle(): Promise<FileSystemFileHandle> {
    const fileHandle = await window.showSaveFilePicker()
    fileHandle.createWritable()
    return fileHandle
  }

  static async getFileHandle(dirName: string, fileName: string): Promise<FileSystemFileHandle> {
    if (GlobalSettings.useMemoryFS) {
      const memfs = await import('./MemoryBackedFileSystem')
      return memfs.MemoryBackedFileSystem.getFileHandle(dirName, fileName)
    }
    if (typeof navigator?.storage !== 'undefined') {
      if (navigator.storage.getDirectory) {
        const rootDir = await navigator.storage.getDirectory()
        const directory = await rootDir.getDirectoryHandle(dirName, {
          create: true,
        })
        return directory.getFileHandle(fileName, { create: true })
      }
      const memfs = await import('./MemoryBackedFileSystem')
      return memfs.MemoryBackedFileSystem.getFileHandle(dirName, fileName)
    } else {
      const nodefs = await import('./NodeFileSystemSyncAccessHandle')
      return nodefs.NodeFileSystemSyncAccessHandle.create(dirName + '/' + fileName)
    }
  }

  static async deleteFile(dirName: string, fileName: string): Promise<any> {
    if (GlobalSettings.useMemoryFS) {
      const memfs = await import('./MemoryBackedFileSystem')
      memfs.MemoryBackedFileSystem.deleteFile(dirName, fileName)
    }
    if (typeof window !== 'undefined') {
      if (navigator.storage.getDirectory) {
        const rootDir = await navigator.storage.getDirectory()
        const directory = await rootDir.getDirectoryHandle(dirName, {
          create: true,
        })
        await directory.removeEntry(fileName)
      }
      const memfs = await import('./MemoryBackedFileSystem')
      memfs.MemoryBackedFileSystem.deleteFile(dirName, fileName)
    } else {
      const nodefs = await import('./NodeFileSystem')
      nodefs.NodeFileSystem.deleteFile(dirName, fileName)
    }
  }
}
