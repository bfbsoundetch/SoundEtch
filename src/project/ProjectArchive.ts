import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import { isObjectRecord } from '../global/TypeGuards'
import { DatabasePersister, type ImportedObjectGraph, type PersistedObject } from '../persistence/DatabasePersister'
import type { Project } from './Project'
import { TarArchive, type TarEntry, type TarOutput, type TarSourceEntry } from './TarArchive'

interface ProjectArchiveManifest {
  readonly format: 'soundetch-project'
  readonly version: 1
  readonly projectId: number
  readonly objects: readonly PersistedObject[]
}

const MANIFEST_ENTRY_NAME = 'soundetch-project.json'
const OPFS_ENTRY_PREFIX = 'opfs/'
const MAX_MANIFEST_SIZE = 16 * 1024 * 1024

export class ProjectArchive {
  static async exportProject(project: Project, output: TarOutput): Promise<void> {
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
    const entries = new Array<TarSourceEntry>(
      {
        name: MANIFEST_ENTRY_NAME,
        data: new Blob([JSON.stringify(manifest)], { type: 'application/json' }),
      },
      ...files.map((file) => ({ name: `${OPFS_ENTRY_PREFIX}${file.path}`, data: file.data })),
    )
    await TarArchive.write(entries, output)
  }

  static async importProject(archive: Blob): Promise<number> {
    const entries = await TarArchive.read(archive)
    const manifestEntry = entries.get(MANIFEST_ENTRY_NAME)
    if (!manifestEntry) {
      throw new Error('The selected file is not a SoundEtch project archive')
    }
    const manifest = await ProjectArchive.readManifest(manifestEntry)
    const rootObject = manifest.objects.find((object) => object.id == manifest.projectId)
    if (rootObject?.restorationName != 'Project') {
      throw new Error('The project archive does not contain its project record')
    }

    const opfsEntries = new Array<TarEntry>()
    for (const entry of entries.values()) {
      if (entry.name == MANIFEST_ENTRY_NAME) {
        continue
      }
      if (!entry.name.startsWith(OPFS_ENTRY_PREFIX)) {
        throw new Error(`Unexpected file in project archive: ${entry.name}`)
      }
      opfsEntries.push(entry)
    }

    let importedGraph: ImportedObjectGraph | null = null
    let importedProjectId: number | null = null
    try {
      importedGraph = await DatabasePersister.importPersistedObjectGraph(manifest.objects, manifest.projectId)
      importedProjectId = importedGraph.idMap.get(manifest.projectId) ?? null
      if (!importedProjectId) {
        throw new Error('The imported project did not receive a database ID')
      }

      const clipIds = new Set(
        manifest.objects.filter((object) => object.restorationName == 'Clip').map((object) => object.id),
      )
      const destinationPaths = new Set<string>()
      for (const entry of opfsEntries) {
        const sourcePath = entry.name.slice(OPFS_ENTRY_PREFIX.length)
        const destinationPath = ProjectArchive.remapClipFilePath(sourcePath, clipIds, importedGraph.idMap)
        if (destinationPaths.has(destinationPath)) {
          throw new Error(`Project archive files map to the same destination: ${destinationPath}`)
        }
        destinationPaths.add(destinationPath)

        const writer = await FileSystemUtils.createFileWriter(String(importedProjectId), destinationPath)
        try {
          await TarArchive.pipeEntry(entry, (data) => writer.write(data))
          await writer.close()
        } catch (error) {
          await writer.abort().catch(() => undefined)
          throw error
        }
      }
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

  private static async readManifest(entry: TarEntry): Promise<ProjectArchiveManifest> {
    const bytes = await TarArchive.readEntry(entry, MAX_MANIFEST_SIZE)
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
    const match = /^(\d+)(_summary)?$/.exec(fileName)
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

  static getSuggestedFileName(projectTitle: string): string {
    const safeTitle = projectTitle
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
      .replace(/[. ]+$/g, '')
    return `${safeTitle || 'soundetch-project'}.soundetch.tar`
  }
}
