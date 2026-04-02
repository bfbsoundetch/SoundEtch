import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import { DatabasePersister } from '../persistence/DatabasePersister'
import { Clip } from './Clip'
import { ClipView } from './ClipView'
import { Project } from './Project'
import { Track } from './Track'

export class ProjectManager {
  static readonly ACTIVE_PROJECT_PROPERTY_NAME = 'activeProject'

  private static activeProject: Project | null
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
    if (project != ProjectManager.activeProject) {
      ProjectManager.activeProject = project
    }
    await DatabasePersister.save(ProjectManager.activeProject)
    ProjectManager.projectListeners.forEach((listener) => listener(project))
  }

  static async getActiveProject(): Promise<Project> {
    if (ProjectManager.activeProject) {
      return ProjectManager.activeProject
    }
    const activeProjectId = await DatabasePersister.getGlobalProperty(ProjectManager.ACTIVE_PROJECT_PROPERTY_NAME)
    if (activeProjectId != null) {
      ProjectManager.activeProject = await DatabasePersister.getObjectById<Project>(Number(activeProjectId))
      await this.populateSummaries(ProjectManager.activeProject!)
    } else {
      ProjectManager.activeProject = await DatabasePersister.save(new Project('My First Etching', 48000))
      await DatabasePersister.setGlobalProperty(
        ProjectManager.ACTIVE_PROJECT_PROPERTY_NAME,
        ProjectManager.activeProject.id,
      )
    }
    return ProjectManager.activeProject!
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

  static async saveTrack(track: Track) {
    await DatabasePersister.save(track)
    const project = await ProjectManager.getActiveProject()
    ProjectManager.trackListeners.get((track as any).id)?.forEach((listener) => listener(track))
    if (!project.getTracks().includes(track)) {
      project.addTrack(track)
      await DatabasePersister.save(project)
      ProjectManager.projectListeners.forEach((listener) => listener(project))
    }
  }

  static async saveClip(clip: Clip) {
    await DatabasePersister.save(clip)
  }

  static async addClipWithTrack(
    name: string,
    channelCount: number,
    length: number,
    startPosition: number,
    source: 'Recording' | 'File',
  ): Promise<Track> {
    const activeProject = await this.getActiveProject()
    const clipName = `${source}: ${name} ${activeProject.getClips().length}`
    const clip = new Clip(clipName, channelCount, length)
    await ProjectManager.addNewClip(clip)

    const clipView = new ClipView(clip, 0, startPosition, 2 ** 31)

    const track = new Track(`${source}: ${name} ${activeProject.getTracks().length}`, channelCount)
    track.addClipView(clipView)

    await ProjectManager.saveTrack(track)
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
