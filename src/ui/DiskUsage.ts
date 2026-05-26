import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import { Clip } from '../project/Clip'
import { Project } from '../project/Project'

export async function getClipDiskUsage(project: Project, clip: Clip): Promise<number> {
  const [clipFile, summaryFile] = await Promise.all([
    (await FileSystemUtils.getFileHandle(project.directoryName, clip.filename)).getFile(),
    (await FileSystemUtils.getFileHandle(project.directoryName, `${clip.filename}_summary`)).getFile(),
  ])
  return clipFile.size + summaryFile.size
}

export function humanizeBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 ** 2) {
    return `${(bytes / 1024).toFixed(1)} KiB`
  }
  if (bytes < 1024 ** 3) {
    return `${(bytes / 1024 ** 2).toFixed(1)} MiB`
  }
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`
}
