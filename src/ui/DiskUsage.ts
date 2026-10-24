import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import { Clip } from '../project/Clip'
import { Project } from '../project/Project'

export async function getClipDiskUsage(project: Project, clip: Clip): Promise<number> {
  const filenames = clip.audioPresent ? [clip.filename, `${clip.filename}_summary`] : []
  filenames.push(...clip.videoSegments.map((segment) => `${clip.filename}_video_${segment.index}`))
  const files = await Promise.all(
    filenames.map(async (filename) =>
      (await FileSystemUtils.getFileHandle(project.directoryName, filename)).getFile(),
    ),
  )
  return files.reduce((total, file) => total + file.size, 0)
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
