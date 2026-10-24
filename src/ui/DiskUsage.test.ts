import 'fake-indexeddb/auto'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import { GlobalSettings } from '../global/GlobalSettings'
import { Clip } from '../project/Clip'
import { Project } from '../project/Project'
import { ProjectManager } from '../project/ProjectManager'
import { getClipDiskUsage } from './DiskUsage'

let project: Project
let previousUseMemoryFS: boolean

beforeEach(async () => {
  previousUseMemoryFS = GlobalSettings.useMemoryFS
  GlobalSettings.useMemoryFS = true
  project = await ProjectManager.createProject('Clip disk usage', 48_000)
})

afterEach(async () => {
  await FileSystemUtils.deleteDirectory(project.directoryName)
  GlobalSettings.useMemoryFS = previousUseMemoryFS
})

async function writeFile(name: string, size: number) {
  const writer = await FileSystemUtils.createFileWriter(project.directoryName, name)
  await writer.write(new Uint8Array(size))
  await writer.close()
}

test('audio-only disk usage includes PCM and waveform files', async () => {
  const clip = new Clip('Audio', 1)
  await ProjectManager.addNewClip(clip)
  await writeFile(clip.filename, 32)
  await writeFile(`${clip.filename}_summary`, 8)

  expect(await getClipDiskUsage(project, clip)).toBe(40)
})

test('linked video disk usage includes every segment without counting unrelated files', async () => {
  const clip = new Clip('Linked video', 1)
  clip.videoSegments = [3, 7].map((index) => ({
    index,
    trackNumber: 1,
    startSample: 0,
    length: 48_000,
    mediaStartSeconds: 0,
    mimeType: 'video/mp4',
  }))
  await ProjectManager.addNewClip(clip)
  await writeFile(clip.filename, 32)
  await writeFile(`${clip.filename}_summary`, 8)
  await writeFile(`${clip.filename}_video_3`, 64)
  await writeFile(`${clip.filename}_video_7`, 128)
  await writeFile('unrelated_video_0', 256)

  expect(await getClipDiskUsage(project, clip)).toBe(232)
})

test('silent video disk usage counts footage without creating absent audio files', async () => {
  const clip = new Clip('Silent video', 1)
  clip.audioPresent = false
  clip.videoLength = 48_000
  clip.videoSegments = [
    { index: 0, trackNumber: 1, startSample: 0, length: 48_000, mediaStartSeconds: 0, mimeType: 'video/mp4' },
  ]
  await ProjectManager.addNewClip(clip)
  await writeFile(`${clip.filename}_video_0`, 120)

  expect(await getClipDiskUsage(project, clip)).toBe(120)
  expect((await FileSystemUtils.getDirectoryFiles(project.directoryName)).map((file) => file.path)).toEqual([
    `${clip.filename}_video_0`,
  ])
})
