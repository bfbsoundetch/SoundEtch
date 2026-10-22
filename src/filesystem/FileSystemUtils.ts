import { GlobalSettings } from '../global/GlobalSettings'
import { MemoryBackedFileSystem } from './MemoryBackedFileSystem'

export interface DirectoryFile {
  readonly path: string
  readonly data: Blob
}

export interface BinaryFileWriter {
  /** Appends at the current position, or writes at `position` and continues from the end of that write. */
  write(data: Uint8Array<ArrayBuffer>, position?: number): Promise<void>
  close(): Promise<void>
  abort(): Promise<void>
}

interface IterableDirectoryHandle extends FileSystemDirectoryHandle {
  values(): AsyncIterableIterator<FileSystemFileHandle | FileSystemDirectoryHandle>
}

export class FileSystemUtils {
  static async getOperatingSystemFileSystemFileHandle(): Promise<FileSystemFileHandle> {
    const fileHandle = await window.showSaveFilePicker()
    fileHandle.createWritable()
    return fileHandle
  }

  static async getFileHandle(dirName: string, fileName: string): Promise<FileSystemFileHandle> {
    if (GlobalSettings.useMemoryFS) {
      return MemoryBackedFileSystem.getFileHandle(dirName, fileName)
    }
    if (FileSystemUtils.hasOpfs()) {
      const rootDir = await navigator.storage.getDirectory()
      const directory = await rootDir.getDirectoryHandle(dirName, {
        create: true,
      })
      return directory.getFileHandle(fileName, { create: true })
    }
    if (typeof window !== 'undefined') {
      return MemoryBackedFileSystem.getFileHandle(dirName, fileName)
    } else {
      const nodefs = await import('./NodeFileSystemSyncAccessHandle')
      return nodefs.NodeFileSystemSyncAccessHandle.create(dirName + '/' + fileName)
    }
  }

  static async getExistingFile(dirName: string, fileName: string): Promise<Blob> {
    if (GlobalSettings.useMemoryFS || (!FileSystemUtils.hasOpfs() && typeof window !== 'undefined')) {
      const handle = MemoryBackedFileSystem.getExistingFileHandle(dirName, fileName)
      if (!handle) {
        throw new DOMException(`File not found: ${fileName}`, 'NotFoundError')
      }
      return handle.getFile()
    }
    if (!FileSystemUtils.hasOpfs()) {
      throw new Error('File access requires OPFS')
    }
    const root = await navigator.storage.getDirectory()
    const directory = await root.getDirectoryHandle(dirName, { create: false })
    const handle = await directory.getFileHandle(fileName, { create: false })
    return handle.getFile()
  }

  static async deleteFile(dirName: string, fileName: string): Promise<void> {
    if (GlobalSettings.useMemoryFS) {
      MemoryBackedFileSystem.deleteFile(dirName, fileName)
      return
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
      MemoryBackedFileSystem.deleteFile(dirName, fileName)
      return
    } else {
      const nodefs = await import('./NodeFileSystem')
      await nodefs.NodeFileSystem.deleteFile(dirName, fileName)
    }
  }

  static async getDirectorySize(dirName: string): Promise<number> {
    if (GlobalSettings.useMemoryFS) {
      return MemoryBackedFileSystem.getDirectorySize(dirName)
    }
    if (FileSystemUtils.hasOpfs()) {
      const rootDir = await navigator.storage.getDirectory()
      const directory = await FileSystemUtils.getDirectoryHandleIfExists(rootDir, dirName)
      return directory ? FileSystemUtils.getOpfsDirectorySize(directory) : 0
    }
    if (typeof window !== 'undefined') {
      return MemoryBackedFileSystem.getDirectorySize(dirName)
    }
    const nodefs = await import('./NodeFileSystem')
    return nodefs.NodeFileSystem.getDirectorySize(dirName)
  }

  static async getDirectoryFiles(dirName: string): Promise<DirectoryFile[]> {
    if (GlobalSettings.useMemoryFS || (!FileSystemUtils.hasOpfs() && typeof window != 'undefined')) {
      return MemoryBackedFileSystem.getDirectoryFiles(dirName)
    }
    if (!FileSystemUtils.hasOpfs()) {
      throw new Error('Project archive file access requires browser storage')
    }

    const rootDir = await navigator.storage.getDirectory()
    const directory = await FileSystemUtils.getDirectoryHandleIfExists(rootDir, dirName)
    if (!directory) {
      return []
    }
    const files = await FileSystemUtils.getOpfsDirectoryFiles(directory)
    return files.sort((left, right) => left.path.localeCompare(right.path))
  }

  static async createFileWriter(dirName: string, relativePath: string): Promise<BinaryFileWriter> {
    const pathSegments = FileSystemUtils.getRelativePathSegments(relativePath)
    if (GlobalSettings.useMemoryFS || (!FileSystemUtils.hasOpfs() && typeof window != 'undefined')) {
      const file = MemoryBackedFileSystem.replaceFileHandle(dirName, pathSegments.join('/'))
      let position = 0
      let open = true
      return {
        async write(data: Uint8Array<ArrayBuffer>, at = position) {
          if (!open) {
            throw new Error('Cannot write to a closed file')
          }
          const buffer = new Uint8Array(data).buffer
          file.write(buffer, { at })
          position = at + data.byteLength
        },
        async close() {
          open = false
        },
        async abort() {
          open = false
          MemoryBackedFileSystem.deleteFile(dirName, pathSegments.join('/'))
        },
      }
    }
    if (!FileSystemUtils.hasOpfs()) {
      throw new Error('Project archive file access requires browser storage')
    }

    const rootDir = await navigator.storage.getDirectory()
    let directory = await rootDir.getDirectoryHandle(dirName, { create: true })
    for (const pathSegment of pathSegments.slice(0, -1)) {
      directory = await directory.getDirectoryHandle(pathSegment, { create: true })
    }
    const fileHandle = await directory.getFileHandle(pathSegments.at(-1)!, { create: true })
    const writable = await fileHandle.createWritable()
    return {
      async write(data: Uint8Array<ArrayBuffer>, position?: number) {
        await writable.write(position === undefined ? data : { type: 'write', position, data })
      },
      async close() {
        await writable.close()
      },
      async abort() {
        await writable.abort()
      },
    }
  }

  static async deleteDirectory(dirName: string): Promise<void> {
    if (GlobalSettings.useMemoryFS) {
      MemoryBackedFileSystem.deleteDirectory(dirName)
      return
    }
    if (FileSystemUtils.hasOpfs()) {
      const rootDir = await navigator.storage.getDirectory()
      try {
        await rootDir.removeEntry(dirName, { recursive: true })
      } catch (error) {
        if (!FileSystemUtils.isNotFoundError(error)) {
          throw error
        }
      }
      return
    }
    if (typeof window !== 'undefined') {
      MemoryBackedFileSystem.deleteDirectory(dirName)
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

  private static async getOpfsDirectoryFiles(
    directory: FileSystemDirectoryHandle,
    pathPrefix = '',
  ): Promise<DirectoryFile[]> {
    const result = new Array<DirectoryFile>()
    // values() is part of the File System Access API but is absent from some bundled DOM typings.
    const iterableDirectory = directory as unknown as IterableDirectoryHandle
    for await (const handle of iterableDirectory.values()) {
      const path = `${pathPrefix}${handle.name}`
      if (handle.kind == 'file') {
        result.push({ path, data: await handle.getFile() })
      } else {
        result.push(...(await FileSystemUtils.getOpfsDirectoryFiles(handle, `${path}/`)))
      }
    }
    return result
  }

  private static getRelativePathSegments(relativePath: string): string[] {
    const pathSegments = relativePath.split('/')
    if (
      pathSegments.length == 0 ||
      pathSegments.some(
        (pathSegment) => !pathSegment || pathSegment == '.' || pathSegment == '..' || pathSegment.includes('\\'),
      )
    ) {
      throw new Error(`Invalid project archive path: ${relativePath}`)
    }
    return pathSegments
  }

  private static async getOpfsDirectorySize(directory: FileSystemDirectoryHandle): Promise<number> {
    let size = 0
    for await (const handle of (directory as unknown as IterableDirectoryHandle).values()) {
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
