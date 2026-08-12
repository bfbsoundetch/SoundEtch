import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import { DatabasePersister } from '../persistence/DatabasePersister'
import { Clip } from './Clip'
import { ClipView } from './ClipView'
import { Project } from './Project'
import { Track } from './Track'

export class ProjectManager {
  static readonly ACTIVE_PROJECT_PROPERTY_NAME = 'activeProject'
  static readonly DEFAULT_PROJECT_TITLE = 'My First Etching'

  private static activeProject: Promise<Project> | null
  private static projectListeners = new Array<(_: Project) => any>()
  private static trackListeners = new Map<number, Array<(_: Track) => any>>()
  private static clipListeners = new Map<number, Array<(_: Clip) => any>>()

  static async addProjectListener(listener: (_: Project) => any) {
    ProjectManager.projectListeners.push(listener)
    listener(await ProjectManager.getActiveProject())
  }

  static async addTrackListener(track: Track, listener: (_: Track) => any) {
    const existing = ProjectManager.trackListeners.get((track as any).id)
    if (existing) {
      existing.push(listener)
    } else {
      ProjectManager.trackListeners.set((track as any).id, [listener])
    }
    listener(track)
  }

  static async addClipListener(clip: Clip, listener: (_: Clip) => any) {
    const existing = ProjectManager.clipListeners.get((clip as any).id)
    if (existing) {
      existing.push(listener)
    } else {
      ProjectManager.clipListeners.set((clip as any).id, [listener])
    }
  }

  static async saveProject(project: Project | null = null) {
    if (!project) {
      project = await ProjectManager.getActiveProject()
    }
    if (project != await ProjectManager.activeProject) {
      ProjectManager.activeProject = Promise.resolve(project)
    }
    await DatabasePersister.save(project)
    ProjectManager.projectListeners.forEach((listener) => listener(project))
  }

  static async getActiveProject(): Promise<Project> {
    if (ProjectManager.activeProject) {
      return ProjectManager.activeProject
    }
    ProjectManager.activeProject = this.createOrLoadActiveProject()
    return ProjectManager.activeProject
  }

  private static async createOrLoadActiveProject() {
    const activeProjectId = await DatabasePersister.getGlobalProperty(ProjectManager.ACTIVE_PROJECT_PROPERTY_NAME)
    let result: Project | null
    if (activeProjectId != null) {
      result = await DatabasePersister.getObjectById<Project>(Number(activeProjectId))
      if (result) {
        await this.populateSummaries(result)
      } else {
        result = await DatabasePersister.save(
          new Project(ProjectManager.DEFAULT_PROJECT_TITLE, 48000),
        )
        await DatabasePersister.setGlobalProperty(
          ProjectManager.ACTIVE_PROJECT_PROPERTY_NAME,
          result.id,
        )
      }
    } else {
      result = await DatabasePersister.save(
        new Project(ProjectManager.DEFAULT_PROJECT_TITLE, 48000),
      )
      await DatabasePersister.setGlobalProperty(
        ProjectManager.ACTIVE_PROJECT_PROPERTY_NAME,
        result.id,
      )
    }
    return result
  }

  static async getProjects(): Promise<Project[]> {
    const projects = await DatabasePersister.getObjectsByRestorationName<Project>('Project')
    return projects.sort(
      (a, b) => (ProjectManager.getProjectModifiedDate(b) ?? 0) - (ProjectManager.getProjectModifiedDate(a) ?? 0),
    )
  }

  static async createProject(title: string = 'Untitled Project', sampleRate = 48000): Promise<Project> {
    ProjectManager.activeProject = DatabasePersister.save(new Project(title, sampleRate))
    const project = await ProjectManager.activeProject
    await DatabasePersister.setGlobalProperty(ProjectManager.ACTIVE_PROJECT_PROPERTY_NAME, project.id)
    ProjectManager.projectListeners.forEach((listener) => listener(project))
    return ProjectManager.activeProject
  }

  static async renameProject(project: Project, title: string): Promise<void> {
    project.title = title
    await DatabasePersister.save(project)
    if ((await ProjectManager.activeProject)?.id == project.id) {
      ProjectManager.projectListeners.forEach((listener) => listener(project))
    }
  }

  static async openProject(projectOrId: Project | number): Promise<Project> {
    const project =
      typeof projectOrId == 'number' ? await DatabasePersister.getObjectById<Project>(projectOrId) : projectOrId
    if (!project) {
      throw new Error('Project not found')
    }
    ProjectManager.activeProject = Promise.resolve(project)
    await this.populateSummaries(project)
    await DatabasePersister.setGlobalProperty(ProjectManager.ACTIVE_PROJECT_PROPERTY_NAME, project.id)
    ProjectManager.projectListeners.forEach((listener) => listener(project))
    return project
  }

  static async deleteProject(project: Project): Promise<void> {
    if (!project.id) {
      return
    }

    const deletedActiveProject = (await ProjectManager.getActiveProject()).id == project.id
    await Promise.all([
      ...project.getTracks().map(async (track) => {
        if (!track.id) {
          return
        }
        ProjectManager.trackListeners.delete(track.id)
        await DatabasePersister.deleteObjectById(track.id)
      }),
      ...project.getClips().map(async (clip) => {
        if (!clip.id) {
          return
        }
        ProjectManager.clipListeners.delete(clip.id)
        await DatabasePersister.deleteObjectById(clip.id)
      }),
    ])
    await FileSystemUtils.deleteDirectory(project.directoryName)
    await DatabasePersister.deleteObjectById(project.id)

    if (!deletedActiveProject) {
      return
    }

    ProjectManager.activeProject = null
    const remainingProjects = await ProjectManager.getProjects()
    if (remainingProjects.length > 0) {
      await ProjectManager.openProject(remainingProjects[0])
    } else {
      await ProjectManager.createProject(ProjectManager.DEFAULT_PROJECT_TITLE, project.sampleRate)
    }
  }

  static async getProjectDiskUsage(project: Project): Promise<number> {
    return FileSystemUtils.getDirectorySize(project.directoryName)
  }

  static getProjectModifiedDate(project: Project): number | undefined {
    const dateModified = Math.max(
      project.dateModified ?? 0,
      ...project.getTracks().map((track) => track.dateModified ?? 0),
      ...project.getClips().map((clip) => clip.dateModified ?? 0),
    )
    return dateModified || undefined
  }

  private static async populateSummaries(project: Project) {
    for (const clip of project.getClips()) {
      const summaryFile = await (
        await FileSystemUtils.getFileHandle(`${project.id}`, `${clip.filename}_summary`)
      ).getFile()
      const mainFile = await (await FileSystemUtils.getFileHandle(`${project.id}`, `${clip.filename}`)).getFile()
      await clip.summary.populateFromFile(summaryFile, mainFile, clip.getChannelCount())
    }
  }

  static async addNewClip(clip: Clip) {
    const savedClip = await DatabasePersister.save(clip)
    const project = await ProjectManager.getActiveProject()
    project.addClip(savedClip)
    await DatabasePersister.save(project)
    this.projectListeners.forEach((listener) => listener(project))
  }

  static async addTrackToProject(track: Track, index: number) {
    const project = await ProjectManager.getActiveProject()
    project.addTrack(track, index)
    await DatabasePersister.save(project)
    ProjectManager.projectListeners.forEach((listener) => listener(project))
  }

  static async saveTrack(track: Track) {
    await DatabasePersister.save(track)
    ProjectManager.trackListeners.get((track as any).id)?.forEach((listener) => listener(track))
  }

  static async saveClip(clip: Clip) {
    await DatabasePersister.save(clip)
  }

  static async addClipWithTrack(
    name: string,
    channelCount: number,
    length: number,
    startPosition: number,
    index: number | null = null,
    tags: Record<string, string> = {},
  ): Promise<Track> {
    const activeProject = await this.getActiveProject()
    const clipName = `${name}`
    const clip = new Clip(clipName, channelCount, length, tags)
    await ProjectManager.addNewClip(clip)

    const clipView = new ClipView(clip, 0, startPosition, 2 ** 31)

    let i = activeProject.getTracks().length + 1
    const titles = activeProject.getTracks().map(t => t.name)
    let trackTitle = `Track ${++i}`
    while (titles.find(t => t == trackTitle)) {
      trackTitle = `Track ${++i}`
    }
    const track = new Track(trackTitle, channelCount)
    track.addClipView(clipView)

    await ProjectManager.saveTrack(track)
    await ProjectManager.addTrackToProject(track, index ?? activeProject.getTracks().length)
    return track
  }

  static async addExistingClipWithTrack(clip: Clip, startPosition: number): Promise<Track> {
    const activeProject = await this.getActiveProject()
    const clipView = new ClipView(clip, 0, startPosition, 2 ** 31)
    const track = new Track(`Clip: ${clip.name} ${activeProject.getTracks().length}`, clip.getChannelCount())
    track.addClipView(clipView)

    await ProjectManager.saveTrack(track)
    await ProjectManager.addTrackToProject(track, activeProject.getTracks().length)
    return track
  }

  static async deleteTrack(track: Track) {
    if (track.id) {
      this.trackListeners.delete(track.id)
      await DatabasePersister.deleteObjectById(track.id)
    }
    const project = await ProjectManager.getActiveProject()
    project.deleteTrack(track)
    await DatabasePersister.save(project)
    this.projectListeners.forEach((listener) => listener(project))
  }

  static async deleteClip(clip: Clip) {
    const project = await ProjectManager.getActiveProject()

    for (const track of project.getTracks()) {
      const clipViewIndexesToRemove: number[] = []
      for (let i = 0; i < track.clipViews.length; ++i) {
        if (track.clipViews[i].clip === clip) {
          clipViewIndexesToRemove.push(i)
        }
      }
      for (let i = clipViewIndexesToRemove.length - 1; i >= 0; --i) {
        track.removeClipView(clipViewIndexesToRemove[i])
      }
      if (clipViewIndexesToRemove.length > 0) {
        await DatabasePersister.save(track)
        ProjectManager.trackListeners.get((track as any).id)?.forEach((listener) => listener(track))
      }
    }

    await Promise.all([
      FileSystemUtils.deleteFile(project.directoryName, clip.filename),
      FileSystemUtils.deleteFile(project.directoryName, `${clip.filename}_summary`),
    ])

    if (clip.id) {
      this.clipListeners.delete(clip.id)
      await DatabasePersister.deleteObjectById(clip.id)
    }
    project.deleteClip(clip)
    await DatabasePersister.save(project)
    this.projectListeners.forEach((listener) => listener(project))
  }
}
