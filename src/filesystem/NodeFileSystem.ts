import { NodeFileSystemSyncAccessHandle } from './NodeFileSystemSyncAccessHandle'

export class NodeFileSystem {
  static async getFileHandle(dirName: string, fileName: string): Promise<NodeFileSystemSyncAccessHandle> {
    const path = `${dirName}/${fileName}`
    return NodeFileSystemSyncAccessHandle.create(path)
  }

  static async deleteFile(dirName: string, fileName: string) {
    const path = `${dirName}/${fileName}`
    ;(await import('fs')).rmSync(path)
  }

  static async deleteDirectory(dirName: string) {
    ;(await import('fs')).rmSync(dirName, { recursive: true, force: true })
  }

  static async getDirectorySize(dirName: string): Promise<number> {
    const fs = await import('fs')
    const path = await import('path')
    return NodeFileSystem.getPathSize(fs, path, dirName)
  }

  private static getPathSize(fs: typeof import('fs'), path: typeof import('path'), filePath: string): number {
    if (!fs.existsSync(filePath)) {
      return 0
    }
    const stats = fs.statSync(filePath)
    if (!stats.isDirectory()) {
      return stats.size
    }
    let size = 0
    for (const entry of fs.readdirSync(filePath)) {
      size += NodeFileSystem.getPathSize(fs, path, path.join(filePath, entry))
    }
    return size
  }
}
