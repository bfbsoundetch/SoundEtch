export interface FileSystemSyncAccessHandle {
  close(): void
  flush(): void
  getSize(): number
  read(buffer: BufferSource, options?: { at: number }): number
  truncate(newSize: number): void
  write(buffer: BufferSource, options?: { at: number }): number
}
