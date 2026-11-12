import 'fake-indexeddb/auto'
import { afterEach, expect, test } from 'vitest'
import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import { MemoryBackedFileSystem } from '../filesystem/MemoryBackedFileSystem'
import { GlobalSettings } from '../global/GlobalSettings'
import { DatabasePersister } from '../persistence/DatabasePersister'
import { Clip } from './Clip'
import { ClipView } from './ClipView'
import { getOutputCropPosition, getOutputCropScale } from './OutputScene'
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
  const [silentTrack, linkedTrack] = project.getTracks()
  project.outputScenes = [
    {
      startSample: 0,
      layout: 'single',
      fit: 'contain',
      tracks: [silentTrack, null],
      cornerRadius: 24,
      margin: 16,
      cropPositions: [
        { x: 0.1, y: 0.2, scale: 1.7 },
        { x: 0.3, y: 0.4, scale: 2.3 },
      ],
    },
    {
      startSample: 24_000,
      layout: 'side-by-side',
      fit: 'cover',
      tracks: [linkedTrack, silentTrack],
      cornerRadius: 80,
      margin: 48,
      cropPositions: [
        { x: 0.9, y: 0.8, scale: 3.4 },
        { x: 0.7, y: 0.6, scale: 1.2 },
      ],
    },
    { startSample: 36_000, layout: 'single', fit: 'cover', tracks: [null, null] },
  ]
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
  const [restoredSilentTrack, restoredLinkedTrack] = restored.getTracks()
  expect(restoredSilentTrack.id).not.toBe(silentTrack.id)
  expect(restoredLinkedTrack.id).not.toBe(linkedTrack.id)
  expect(restored.outputScenes).toEqual([
    {
      startSample: 0,
      layout: 'single',
      fit: 'contain',
      tracks: [restoredSilentTrack, null],
      cornerRadius: 24,
      margin: 16,
      cropPositions: [
        { x: 0.1, y: 0.2, scale: 1.7 },
        { x: 0.3, y: 0.4, scale: 2.3 },
      ],
    },
    {
      startSample: 24_000,
      layout: 'side-by-side',
      fit: 'cover',
      tracks: [restoredLinkedTrack, restoredSilentTrack],
      cornerRadius: 80,
      margin: 48,
      cropPositions: [
        { x: 0.9, y: 0.8, scale: 3.4 },
        { x: 0.7, y: 0.6, scale: 1.2 },
      ],
    },
    { startSample: 36_000, layout: 'single', fit: 'cover', tracks: [null, null] },
  ])
  expect(restored.outputScenes[0].tracks[0]).toBe(restoredSilentTrack)
  expect(restored.outputScenes[1].tracks[0]).toBe(restoredLinkedTrack)
  expect(restored.outputScenes[1].tracks[1]).toBe(restoredSilentTrack)
  expect(getOutputCropPosition(restored.outputScenes[2], 0)).toEqual({ x: 0.5, y: 0.5 })
  expect(getOutputCropPosition(restored.outputScenes[2], 1)).toEqual({ x: 0.5, y: 0.5 })
  expect(restored.outputScenes.map((scene) => [getOutputCropScale(scene, 0), getOutputCropScale(scene, 1)])).toEqual([
    [1.7, 2.3],
    [3.4, 1.2],
    [1, 1],
  ])
  restored.outputScenes[0].fit = 'cover'
  restored.outputScenes[1].cropPositions![0].x = 0
  restored.outputScenes[1].cropPositions![0].scale = 4
  expect(getOutputCropPosition(restored.outputScenes[0], 0)).toEqual({ x: 0.1, y: 0.2, scale: 1.7 })
  expect(getOutputCropPosition(restored.outputScenes[1], 1)).toEqual({ x: 0.7, y: 0.6, scale: 1.2 })
  expect(getOutputCropPosition(project.outputScenes[1], 0)).toEqual({ x: 0.9, y: 0.8, scale: 3.4 })
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

test('an import in progress is hidden and kept until its files are written', async () => {
  const source = await ProjectManager.createProject('importing', 48_000)
  directories.add(source.directoryName)
  const { manifest } = await ProjectArchive.snapshotProject(source)
  const listedBefore = (await ProjectManager.getProjects()).map((project) => project.id)
  const copyStarted = Promise.withResolvers<void>()
  const copyAllowed = Promise.withResolvers<void>()
  const importing = ProjectArchive.importMembers(
    ProjectArchive.parseManifest(new Uint8Array(await manifest.arrayBuffer())),
    [
      {
        name: 'opfs/notes',
        async copyTo(write) {
          copyStarted.resolve()
          await copyAllowed.promise
          await write(new Uint8Array([1, 2, 3]))
        },
      },
    ],
  )

  await copyStarted.promise
  expect((await ProjectManager.getProjects()).map((project) => project.id)).toEqual(listedBefore)
  copyAllowed.resolve()
  const importedId = await importing
  directories.add(String(importedId))

  const imported = (await ProjectManager.getProjects()).find((project) => project.id == importedId)
  expect(imported?.importInProgress).toBe(false)
  const files = await FileSystemUtils.getDirectoryFiles(String(importedId))
  expect(files.map((file) => file.path)).toEqual(['notes'])
  expect(new Uint8Array(await files[0].data.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
})

test('listing projects deletes a project left behind by an interrupted import', async () => {
  const source = await ProjectManager.createProject('crashed', 48_000)
  directories.add(source.directoryName)
  await ProjectManager.addNewClip(new Clip('clip', 1))
  const objects = await DatabasePersister.getPersistedObjectGraph(source.id!)
  const { idMap, importedIds } = await DatabasePersister.importPersistedObjectGraph(
    objects.map((object) => (object.id == source.id ? { ...object, importInProgress: true } : object)),
    source.id!,
  )
  const leftoverDirectory = String(idMap.get(source.id!))
  directories.add(leftoverDirectory)
  await writeFile(leftoverDirectory, 'leftover', new Uint8Array([9]))

  const listed = (await ProjectManager.getProjects()).map((project) => project.id)

  expect(listed).toContain(source.id)
  expect(importedIds).toHaveLength(2)
  for (const id of importedIds) {
    expect(listed).not.toContain(id)
    expect(await DatabasePersister.getObjectById(id)).toBeFalsy()
  }
  expect(await FileSystemUtils.getDirectoryFiles(leftoverDirectory)).toEqual([])
})

test('a project whose metadata exceeds 16 MiB cannot be archived', async () => {
  const project = await ProjectManager.createProject('huge', 48_000)
  directories.add(project.directoryName)
  project.description = 'x'.repeat(16 * 1024 * 1024 + 1)
  await ProjectManager.saveProject(project)
  try {
    await expect(ProjectArchive.snapshotProject(project)).rejects.toThrow(
      "The project's metadata is larger than 16 MiB and cannot be archived",
    )
  } finally {
    await DatabasePersister.deleteObjectsByIds([project.id!])
  }
})
