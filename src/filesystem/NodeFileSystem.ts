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
}
