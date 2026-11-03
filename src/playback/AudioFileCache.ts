import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import { FileSystemSyncAccessHandle } from '../filesystem/FileSystemSyncAccessHandle'

export class AudioFileCache {
  private static readonly cache = new Map<string, Promise<FileSystemSyncAccessHandle>>()

  static async getHandle(dirName: string, fileName: string) {
    const key = `${dirName}/${fileName}`
    const cached = this.cache.get(key)
    if (cached) {
      return cached
    }
    const handle = FileSystemUtils.getReadOnlySyncAccessHandle(dirName, fileName)
    this.cache.set(key, handle)
    return handle
  }

  static async cleanUp() {
    for (const entry of this.cache.entries()) {
      ;(await entry[1]).close()
    }
    this.cache.clear()
  }
}
