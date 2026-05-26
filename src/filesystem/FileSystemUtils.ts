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
    if (FileSystemUtils.hasOpfs()) {
      const rootDir = await navigator.storage.getDirectory()
      const directory = await rootDir.getDirectoryHandle(dirName, {
        create: true,
      })
      return directory.getFileHandle(fileName, { create: true })
    }
    if (typeof window !== 'undefined') {
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
      return memfs.MemoryBackedFileSystem.deleteFile(dirName, fileName)
    }
    if (FileSystemUtils.hasOpfs()) {
      const rootDir = await navigator.storage.getDirectory()
      const directory = await FileSystemUtils.getDirectoryHandleIfExists(rootDir, dirName)
      if (!directory) {
        return
      }
      try {
        await directory.removeEntry(fileName)
      } catch (error) {
        if (!FileSystemUtils.isNotFoundError(error)) {
          throw error
        }
      }
      return
    }
    if (typeof window !== 'undefined') {
      const memfs = await import('./MemoryBackedFileSystem')
      return memfs.MemoryBackedFileSystem.deleteFile(dirName, fileName)
    } else {
      const nodefs = await import('./NodeFileSystem')
      await nodefs.NodeFileSystem.deleteFile(dirName, fileName)
    }
  }

  static async getDirectorySize(dirName: string): Promise<number> {
    if (GlobalSettings.useMemoryFS) {
      const memfs = await import('./MemoryBackedFileSystem')
      return memfs.MemoryBackedFileSystem.getDirectorySize(dirName)
    }
    if (FileSystemUtils.hasOpfs()) {
      const rootDir = await navigator.storage.getDirectory()
      const directory = await FileSystemUtils.getDirectoryHandleIfExists(rootDir, dirName)
      return directory ? FileSystemUtils.getOpfsDirectorySize(directory) : 0
    }
    if (typeof window !== 'undefined') {
      const memfs = await import('./MemoryBackedFileSystem')
      return memfs.MemoryBackedFileSystem.getDirectorySize(dirName)
    }
    const nodefs = await import('./NodeFileSystem')
    return nodefs.NodeFileSystem.getDirectorySize(dirName)
  }

  static async deleteDirectory(dirName: string): Promise<void> {
    if (GlobalSettings.useMemoryFS) {
      const memfs = await import('./MemoryBackedFileSystem')
      memfs.MemoryBackedFileSystem.deleteDirectory(dirName)
      return
    }
    if (FileSystemUtils.hasOpfs()) {
      const rootDir = await navigator.storage.getDirectory()
      try {
        await (rootDir as any).removeEntry(dirName, { recursive: true })
      } catch (error) {
        if (!FileSystemUtils.isNotFoundError(error)) {
          throw error
        }
      }
      return
    }
    if (typeof window !== 'undefined') {
      const memfs = await import('./MemoryBackedFileSystem')
      memfs.MemoryBackedFileSystem.deleteDirectory(dirName)
      return
    }
    const nodefs = await import('./NodeFileSystem')
    await nodefs.NodeFileSystem.deleteDirectory(dirName)
  }

  private static hasOpfs(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory == 'function'
  }

  private static async getDirectoryHandleIfExists(
    rootDir: FileSystemDirectoryHandle,
    dirName: string,
  ): Promise<FileSystemDirectoryHandle | null> {
    try {
      return await rootDir.getDirectoryHandle(dirName)
    } catch (error) {
      if (FileSystemUtils.isNotFoundError(error)) {
        return null
      }
      throw error
    }
  }

  private static async getOpfsDirectorySize(directory: FileSystemDirectoryHandle): Promise<number> {
    let size = 0
    for await (const handle of (directory as any).values()) {
      if (handle.kind == 'file') {
        size += (await handle.getFile()).size
      } else {
        size += await FileSystemUtils.getOpfsDirectorySize(handle)
      }
    }
    return size
  }

  private static isNotFoundError(error: unknown): boolean {
    return error instanceof DOMException && error.name == 'NotFoundError'
  }
}
