import { FileSystemSyncAccessHandle } from './FileSystemSyncAccessHandle.js'

export class NodeFileSystemSyncAccessHandle implements FileSystemSyncAccessHandle, FileSystemFileHandle {
  private readonly fileDescriptor: number

  readonly name: string

  private constructor(
    private fs: any,
    private fsPromises: any,
    path: string,
  ) {
    this.fileDescriptor = fs.openSync(path, 'w+')
    this.name = path
  }

  /** Like OPFS `getDirectoryHandle(dirName, { create: true })`, a missing directory is created rather than an error. */
  static async create(path: string): Promise<NodeFileSystemSyncAccessHandle> {
    // Node built-ins load lazily: the browser build also bundles this module, behind FileSystemUtils' Node-only branch.
    const fs = await import('fs')
    const { dirname } = await import('path')
    fs.mkdirSync(dirname(path), { recursive: true })
    return new NodeFileSystemSyncAccessHandle(fs, null, path)
  }

  close(): void {
    this.fs.closeSync(this.fileDescriptor)
  }
  flush(): void {
    this.fs.fsync(this.fileDescriptor, (exception: any) => {
      exception && console.warn('Exception flushing during file writing: ' + exception)
    })
  }
  getSize(): number {
    return this.fs.fstatSync(this.fileDescriptor).size
  }
  read(buffer: ArrayBuffer, options: { at: number }): number {
    return this.fs.readSync(this.fileDescriptor, new Uint8Array(buffer), 0, buffer.byteLength, options?.at || 0)
  }
  truncate(newSize: number): void {
    this.fs.ftruncateSync(this.fileDescriptor, newSize)
  }
  write(buffer: ArrayBuffer, options: { at: number }): number {
    return this.fs.writeSync(this.fileDescriptor, new Uint8Array(buffer), 0, buffer.byteLength, options?.at)
  }

  readonly kind: 'file' = 'file'

  async createWritable(options?: unknown): Promise<FileSystemWritableFileStream> {
    const fs = this.fs
    const fd = this.fileDescriptor
    let position = 0
    const result = new WritableStream({
      write(chunk, controller) {
        position += fs.writeSync(fd, chunk, 0, chunk.byteLength, position)
      },
    })
    ;(result as any).seek = async function (p: number): Promise<void> {
      position = p
    }
    ;(result as any).truncate = function (size: number): Promise<void> {
      throw new Error('Function not implemented.')
    }
    ;(result as any).write = async function (data: FileSystemWriteChunkType): Promise<void> {
      position += fs.writeSync(fd, data, 0, (data as any).byteLength, position)
    }
    return result as FileSystemWritableFileStream
  }

  async getFile(): Promise<File> {
    const { Readable } = await import('stream')
    return {
      size: this.fs.statSync(this.name).size,
      stream: () => Readable.toWeb(this.fs.createReadStream(this.name)),
    } as any
  }

  readonly isFile = true

  readonly isDirectory = false

  isSameEntry(other: unknown): Promise<boolean> {
    throw new Error('Method not implemented.')
  }
  queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState> {
    throw new Error('Method not implemented.')
  }
  requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState> {
    throw new Error('Method not implemented.')
  }
  async createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle> {
    return this
  }
}
