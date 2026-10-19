import 'fake-indexeddb/auto'
import { afterEach, expect, test } from 'vitest'
import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import { MemoryBackedFileSystem } from '../filesystem/MemoryBackedFileSystem'
import { GlobalSettings } from '../global/GlobalSettings'
import { Clip } from './Clip'
import { ClipView } from './ClipView'
import { ProjectArchive } from './ProjectArchive'
import { ProjectManager } from './ProjectManager'
import { Track } from './Track'

GlobalSettings.useMemoryFS = true
const directories = new Set<string>()

afterEach(async () => {
  for (const directory of directories) await FileSystemUtils.deleteDirectory(directory)
  directories.clear()
})

async function writeFile(directory: string, name: string, bytes: Uint8Array<ArrayBuffer>) {
  const writer = await FileSystemUtils.createFileWriter(directory, name)
  await writer.write(bytes)
  await writer.close()
}

test('project archives remap video sidecars and preserve silent and linked sources across reload and deletion', async () => {
  const project = await ProjectManager.createProject('video archive', 48_000)
  directories.add(project.directoryName)
  const silent = new Clip('silent', 1)
  silent.audioPresent = false
  silent.videoLength = 48_000
  silent.videoSegments = [
    { index: 0, trackNumber: 1, startSample: 0, length: 48_000, mediaStartSeconds: 0, mimeType: 'video/mp4' },
  ]
  const linked = new Clip('linked', 1, 4)
  linked.videoLength = 8
  linked.videoSegments = [
    { index: 3, trackNumber: 2, startSample: 0, length: 8, mediaStartSeconds: 2, mimeType: 'video/webm' },
  ]
  for (const clip of [silent, linked]) {
    await ProjectManager.addNewClip(clip)
    const track = new Track(clip.name, 1)
    track.addClipView(new ClipView(clip, 0, 24_000, clip.length))
    await ProjectManager.saveTrack(track)
    await ProjectManager.addTrackToProject(track, project.getTracks().length)
  }
  const silentBytes = new Uint8Array([0, 1, 2, 3, 255])
  const linkedBytes = new Uint8Array([8, 6, 4, 2, 0])
  await writeFile(project.directoryName, `${silent.filename}_video_0`, silentBytes)
  await writeFile(project.directoryName, `${linked.filename}_video_3`, linkedBytes)
  await writeFile(
    project.directoryName,
    linked.filename,
    new Uint8Array(new Float32Array([0.1, -0.2, 0.3, -0.4]).buffer),
  )
  await writeFile(project.directoryName, `${linked.filename}_summary`, new Uint8Array())
  await ProjectManager.saveProject(project)

  const parts: Uint8Array<ArrayBuffer>[] = []
  await ProjectArchive.exportProject(project, {
    async write(data) {
      parts.push(data.slice())
    },
  })
  const importedId = await ProjectArchive.importProject(new Blob(parts))
  directories.add(String(importedId))
  const restored = await ProjectManager.openProject(importedId)
  const restoredSilent = restored.getClips().find((clip) => clip.name === 'silent')!
  const restoredLinked = restored.getClips().find((clip) => clip.name === 'linked')!

  expect(restoredSilent.id).not.toBe(silent.id)
  expect(restoredLinked.id).not.toBe(linked.id)
  expect(restoredSilent.length).toBe(48_000)
  expect(restoredSilent.summary.length).toBe(0)
  expect(restoredSilent.audioPresent).toBe(false)
  expect(restoredLinked.length).toBe(8)
  expect(restoredLinked.summary.length).toBe(4)
  expect(restoredLinked.videoSegments).toEqual(linked.videoSegments)
  expect(restored.getTracks()[0].clipViews[0].clip).toBe(restoredSilent)
  expect(
    new Uint8Array(
      await (
        await FileSystemUtils.getExistingFile(restored.directoryName, `${restoredSilent.filename}_video_0`)
      ).arrayBuffer(),
    ),
  ).toEqual(silentBytes)
  expect(
    new Uint8Array(
      await (
        await FileSystemUtils.getExistingFile(restored.directoryName, `${restoredLinked.filename}_video_3`)
      ).arrayBuffer(),
    ),
  ).toEqual(linkedBytes)
  expect(MemoryBackedFileSystem.getExistingFileHandle(restored.directoryName, restoredSilent.filename)).toBeNull()
  expect(
    MemoryBackedFileSystem.getExistingFileHandle(restored.directoryName, `${restoredSilent.filename}_summary`),
  ).toBeNull()

  await ProjectManager.deleteClip(restoredSilent)
  await expect(
    FileSystemUtils.getExistingFile(restored.directoryName, `${restoredSilent.filename}_video_0`),
  ).rejects.toMatchObject({ name: 'NotFoundError' })
  expect(
    new Uint8Array(
      await (
        await FileSystemUtils.getExistingFile(restored.directoryName, `${restoredLinked.filename}_video_3`)
      ).arrayBuffer(),
    ),
  ).toEqual(linkedBytes)
})

test('missing video reads never create files or directories', async () => {
  const directory = 'missing-video-read'
  directories.add(directory)
  await expect(FileSystemUtils.getExistingFile(directory, '123_video_0')).rejects.toMatchObject({
    name: 'NotFoundError',
  })
  expect(MemoryBackedFileSystem.getDirectoryFiles(directory)).toEqual([])
})
