import { FileSystemUtils, type DirectoryFile } from '../filesystem/FileSystemUtils'
import { isObjectRecord } from '../global/TypeGuards'
import { DatabasePersister, type ImportedObjectGraph, type PersistedObject } from '../persistence/DatabasePersister'
import type { Project } from './Project'
import { ProjectManager } from './ProjectManager'
import { TarArchive, type TarOutput, type TarSourceEntry } from './TarArchive'

export interface ProjectArchiveManifest {
  readonly format: 'soundetch-project'
  readonly version: 1
  readonly projectId: number
  readonly objects: readonly PersistedObject[]
}

export interface ProjectArchiveMember {
  /** Path inside the archive, e.g. `opfs/12_video_0`. */
  readonly name: string
  /** Writes the member's bytes in order. */
  copyTo(write: (data: Uint8Array<ArrayBuffer>) => Promise<void>): Promise<void>
}

export interface ProjectArchiveSnapshot {
  readonly manifest: Blob
  readonly files: readonly DirectoryFile[]
}

export const PROJECT_ARCHIVE_MANIFEST_NAME = 'soundetch-project.json'
export const PROJECT_ARCHIVE_FILE_PREFIX = 'opfs/'
export const MAX_PROJECT_ARCHIVE_MANIFEST_SIZE = 16 * 1024 * 1024

export class ProjectArchive {
  static async snapshotProject(project: Project): Promise<ProjectArchiveSnapshot> {
    if (!project.id) {
      throw new Error('The current project has not been saved')
    }

    const [objects, files] = await Promise.all([
      DatabasePersister.getPersistedObjectGraph(project.id),
      FileSystemUtils.getDirectoryFiles(project.directoryName),
    ])
    const manifest: ProjectArchiveManifest = {
      format: 'soundetch-project',
      version: 1,
      projectId: project.id,
      objects,
    }
    const manifestBlob = new Blob([JSON.stringify(manifest)], { type: 'application/json' })
    if (manifestBlob.size > MAX_PROJECT_ARCHIVE_MANIFEST_SIZE) {
      throw new Error("The project's metadata is larger than 16 MiB and cannot be archived")
    }
    return { manifest: manifestBlob, files }
  }

  static async exportProject(project: Project, output: TarOutput): Promise<void> {
    const { manifest, files } = await ProjectArchive.snapshotProject(project)
    const entries = new Array<TarSourceEntry>(
      { name: PROJECT_ARCHIVE_MANIFEST_NAME, data: manifest },
      ...files.map((file) => ({ name: `${PROJECT_ARCHIVE_FILE_PREFIX}${file.path}`, data: file.data })),
    )
    await TarArchive.write(entries, output)
  }

  static async importProject(archive: Blob): Promise<number> {
    const entries = await TarArchive.read(archive)
    const manifestEntry = entries.get(PROJECT_ARCHIVE_MANIFEST_NAME)
    if (!manifestEntry) {
      throw new Error('The selected file is not a SoundEtch project archive')
    }
    const manifest = ProjectArchive.parseManifest(
      await TarArchive.readEntry(manifestEntry, MAX_PROJECT_ARCHIVE_MANIFEST_SIZE),
    )
    const members = [...entries.values()]
      .filter((entry) => entry.name != PROJECT_ARCHIVE_MANIFEST_NAME)
      .map((entry): ProjectArchiveMember => ({
        name: entry.name,
        copyTo: (write) => TarArchive.pipeEntry(entry, write),
      }))
    return ProjectArchive.importMembers(manifest, members)
  }

  /**
   * Imports the manifest's objects as a new project and writes `members` into its directory. The project stays
   * hidden until every file is written; a failure removes everything imported so far.
   */
  static async importMembers(
    manifest: ProjectArchiveManifest,
    members: readonly ProjectArchiveMember[],
  ): Promise<number> {
    const locks: LockManager | undefined = globalThis.navigator?.locks
    if (!locks) {
      return ProjectArchive.importMembersHoldingLock(manifest, members)
    }
    // Shared: concurrent imports may run, but abandoned-import cleanup waits for all of them.
    return locks.request(ProjectManager.PROJECT_IMPORT_LOCK_NAME, { mode: 'shared' }, () =>
      ProjectArchive.importMembersHoldingLock(manifest, members),
    )
  }

  private static async importMembersHoldingLock(
    manifest: ProjectArchiveManifest,
    members: readonly ProjectArchiveMember[],
  ): Promise<number> {
    const rootObject = manifest.objects.find((object) => object.id == manifest.projectId)
    if (rootObject?.restorationName != 'Project') {
      throw new Error('The project archive does not contain its project record')
    }

    for (const member of members) {
      if (!member.name.startsWith(PROJECT_ARCHIVE_FILE_PREFIX)) {
        throw new Error(`Unexpected file in project archive: ${member.name}`)
      }
    }

    // Hides the project from the project list until its files are complete.
    const objects = manifest.objects.map((object) =>
      object === rootObject ? { ...rootObject, importInProgress: true } : object,
    )
    let importedGraph: ImportedObjectGraph | null = null
    let importedProjectId: number | null = null
    try {
      importedGraph = await DatabasePersister.importPersistedObjectGraph(objects, manifest.projectId)
      importedProjectId = importedGraph.idMap.get(manifest.projectId) ?? null
      if (!importedProjectId) {
        throw new Error('The imported project did not receive a database ID')
      }

      const clipIds = new Set(
        manifest.objects.filter((object) => object.restorationName == 'Clip').map((object) => object.id),
      )
      const destinationPaths = new Set<string>()
      for (const member of members) {
        const sourcePath = member.name.slice(PROJECT_ARCHIVE_FILE_PREFIX.length)
        const destinationPath = ProjectArchive.remapClipFilePath(sourcePath, clipIds, importedGraph.idMap)
        if (destinationPaths.has(destinationPath)) {
          throw new Error(`Project archive files map to the same destination: ${destinationPath}`)
        }
        destinationPaths.add(destinationPath)

        const writer = await FileSystemUtils.createFileWriter(String(importedProjectId), destinationPath)
        try {
          await member.copyTo((data) => writer.write(data))
          await writer.close()
        } catch (error) {
          await writer.abort().catch(() => undefined)
          throw error
        }
      }

      const imported = await DatabasePersister.getObjectById<Project>(importedProjectId)
      imported!.importInProgress = false
      await DatabasePersister.save(imported!)
      return importedProjectId
    } catch (error) {
      const cleanupFailures = new Array<unknown>()
      if (importedProjectId) {
        try {
          await FileSystemUtils.deleteDirectory(String(importedProjectId))
        } catch (cleanupError) {
          cleanupFailures.push(cleanupError)
        }
      }
      if (importedGraph) {
        try {
          await DatabasePersister.deleteObjectsByIds(importedGraph.importedIds)
        } catch (cleanupError) {
          cleanupFailures.push(cleanupError)
        }
      }
      if (cleanupFailures.length > 0) {
        throw new AggregateError([error, ...cleanupFailures], 'Project import failed and could not be fully cleaned up')
      }
      throw error
    }
  }

  static parseManifest(bytes: Uint8Array): ProjectArchiveManifest {
    let parsed: unknown
    try {
      parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    } catch {
      throw new Error('The project archive manifest is not valid JSON')
    }
    if (
      !isObjectRecord(parsed) ||
      parsed.format != 'soundetch-project' ||
      parsed.version != 1 ||
      typeof parsed.projectId != 'number' ||
      !Number.isSafeInteger(parsed.projectId) ||
      !Array.isArray(parsed.objects)
    ) {
      throw new Error('The project archive manifest is invalid or unsupported')
    }

    const objects = parsed.objects.map((value) => {
      if (!isObjectRecord(value) || typeof value.id != 'number' || !Number.isSafeInteger(value.id) || value.id <= 0) {
        throw new Error('The project archive manifest contains an invalid database object')
      }
      return value as PersistedObject
    })
    return {
      format: 'soundetch-project',
      version: 1,
      projectId: parsed.projectId,
      objects,
    }
  }

  private static remapClipFilePath(
    sourcePath: string,
    clipIds: ReadonlySet<number>,
    idMap: ReadonlyMap<number, number>,
  ): string {
    const pathSegments = sourcePath.split('/')
    const fileName = pathSegments.at(-1)
    if (!fileName) {
      throw new Error(`Invalid OPFS path in project archive: ${sourcePath}`)
    }
    const match = /^(\d+)(_summary|_video_\d+)?$/.exec(fileName)
    if (!match) {
      return sourcePath
    }

    const oldClipId = Number(match[1])
    if (!clipIds.has(oldClipId)) {
      return sourcePath
    }
    const newClipId = idMap.get(oldClipId)
    if (!newClipId) {
      throw new Error(`The project archive is missing clip ${oldClipId}`)
    }
    pathSegments[pathSegments.length - 1] = `${newClipId}${match[2] ?? ''}`
    return pathSegments.join('/')
  }

  /** The project title without characters that file systems reject. */
  static getSafeFileTitle(projectTitle: string): string {
    const safeTitle = projectTitle
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
      .replace(/[. ]+$/g, '')
    return safeTitle || 'soundetch-project'
  }

  static getSuggestedFileName(projectTitle: string): string {
    return `${ProjectArchive.getSafeFileTitle(projectTitle)}.soundetch.tar`
  }
}
