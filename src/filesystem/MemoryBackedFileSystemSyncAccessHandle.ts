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

  read(buffer: BufferSource, options: { at: number } = { at: 0 }): number {
    if (options.at < 0 || options.at > this.size) {
      throw new TypeError('offset `options.at` value out of range: ' + options.at + ' for file of size ' + this.size)
    }
    const target = MemoryBackedFileSystemSyncAccessHandle.bytesOf(buffer)
    const start = options.at ?? 0
    let read = 0
    while (read < target.byteLength && start + read < this.size) {
      const position = start + read
      const chunkIndex = Math.floor(position / MemoryBackedFileSystemSyncAccessHandle.CHUNK_SIZE)
      const chunkOffset = position - chunkIndex * MemoryBackedFileSystemSyncAccessHandle.CHUNK_SIZE
      const count = Math.min(
        target.byteLength - read,
        MemoryBackedFileSystemSyncAccessHandle.CHUNK_SIZE - chunkOffset,
        this.size - position,
      )
      target.set(new Uint8Array(this.buffers[chunkIndex], chunkOffset, count), read)
      read += count
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

  write(buffer: AllowSharedBufferSource, options: { at: number } = { at: 0 }): number {
    if (options.at < 0 || options.at > 2 * 1024 * 1024 * 1024) {
      throw new TypeError('offset `options.at` value out of range: ' + options.at)
    }
    const source = MemoryBackedFileSystemSyncAccessHandle.bytesOf(buffer)
    const start = options.at ?? this.size
    while (start + source.byteLength > this.buffers.length * MemoryBackedFileSystemSyncAccessHandle.CHUNK_SIZE) {
      this.buffers.push(new SharedArrayBuffer(MemoryBackedFileSystemSyncAccessHandle.CHUNK_SIZE))
    }
    let written = 0
    while (written < source.byteLength) {
      const position = start + written
      const chunkIndex = Math.floor(position / MemoryBackedFileSystemSyncAccessHandle.CHUNK_SIZE)
      const chunkOffset = position - chunkIndex * MemoryBackedFileSystemSyncAccessHandle.CHUNK_SIZE
      const count = Math.min(
        source.byteLength - written,
        MemoryBackedFileSystemSyncAccessHandle.CHUNK_SIZE - chunkOffset,
      )
      new Uint8Array(this.buffers[chunkIndex]).set(source.subarray(written, written + count), chunkOffset)
      written += count
    }
    // Overwriting within the file leaves its size alone, as OPFS does.
    this.size = Math.max(this.size, start + written)
    return written
  }

  /** The bytes `buffer` refers to, without copying, so reads land in the caller's view. */
  private static bytesOf(buffer: AllowSharedBufferSource): Uint8Array {
    return ArrayBuffer.isView(buffer)
      ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
      : new Uint8Array(buffer)
  }

  async createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle> {
    return this
  }
}
