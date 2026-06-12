import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import { FileSystemSyncAccessHandle } from '../filesystem/FileSystemSyncAccessHandle'

export class AudioFileCache {
  private static readonly cache = new Map<string, Promise<FileSystemSyncAccessHandle>>()

  static async getHandle(dirName: string, fileName: string) {
    const key = `${dirName}/${fileName}`
    if (this.cache.has(key)) {
      return this.cache.get(key)
    }
    const handle = FileSystemUtils.getFileHandle(dirName, fileName).then((h: any) => h.createSyncAccessHandle())
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
