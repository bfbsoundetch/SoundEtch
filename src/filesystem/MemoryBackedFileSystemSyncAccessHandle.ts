import { FileSystemSyncAccessHandle } from './FileSystemSyncAccessHandle'

export class MemoryBackedFileSystemSyncAccessHandle implements FileSystemSyncAccessHandle, FileSystemFileHandle {
  private static CHUNK_SIZE = 256 * 1024

  private readonly buffers = new Array<SharedArrayBuffer>()
  private size = 0
  private closed = false

  readonly kind: 'file' = 'file'

  constructor(readonly name: string) {}

  createWritable(options?: unknown): Promise<FileSystemWritableFileStream> {
    throw new Error('Method not implemented.')
  }

  async getFile(): Promise<File> {
    const name = this.name.split('/').at(-1) ?? this.name
    return new File([this.toBlob()], name)
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

  close() {
    this.closed = true
  }

  flush() {}

  getSize(): number {
    return this.size
  }

  toBlob(): Blob {
    const data = new Uint8Array(this.size)
    this.read(data.buffer)
    return new Blob([data])
  }

  read(buffer: ArrayBuffer, options: { at: number } = { at: 0 }): number {
    if (options.at < 0 || options.at > this.size) {
      throw new TypeError('offset `options.at` value out of range: ' + options.at + ' for file of size ' + this.size)
    }
    const start = options.at ?? 0
    var read = 0
    while (read < buffer.byteLength && start + read < this.size) {
      const chunkIndex = Math.floor((start + read) / MemoryBackedFileSystemSyncAccessHandle.CHUNK_SIZE)
      const readStart = start + read - chunkIndex * MemoryBackedFileSystemSyncAccessHandle.CHUNK_SIZE
      const readBuffer = new Uint8Array(this.buffers[chunkIndex]).subarray(
        readStart,
        Math.min(buffer.byteLength, this.size) - read,
      )
      new Uint8Array(buffer).set(readBuffer, read)
      read += readBuffer.byteLength
    }
    return read
  }

  truncate(newSize: number): void {
    if (newSize < 0 || newSize > this.size) {
      throw new TypeError('newSize value out of range: ' + newSize)
    }
    if (this.closed) {
      throw new Error('File is already closed')
    }
    this.size = newSize
  }

  write(buffer: ArrayBuffer, options: { at: number } = { at: 0 }): number {
    if (options.at < 0 || options.at > 2 * 1024 * 1024 * 1024) {
      throw new TypeError('offset `options.at` value out of range: ' + options.at)
    }
    const start = options.at ?? this.size
    while (start + buffer.byteLength > this.buffers.length * MemoryBackedFileSystemSyncAccessHandle.CHUNK_SIZE) {
      this.buffers.push(new SharedArrayBuffer(MemoryBackedFileSystemSyncAccessHandle.CHUNK_SIZE))
    }
    var written = 0
    while (written < buffer.byteLength) {
      const chunkIndex = Math.floor((start + written) / MemoryBackedFileSystemSyncAccessHandle.CHUNK_SIZE)
      const writeStart = start + written - chunkIndex * MemoryBackedFileSystemSyncAccessHandle.CHUNK_SIZE
      const writeBuffer = new Uint8Array(buffer).subarray(
        written,
        MemoryBackedFileSystemSyncAccessHandle.CHUNK_SIZE - writeStart,
      )
      new Uint8Array(this.buffers[chunkIndex]).set(writeBuffer, writeStart)
      written += writeBuffer.byteLength
    }
    this.size += written
    return written
  }

  createSyncAccessHandle(): FileSystemSyncAccessHandle {
    return this
  }
}
