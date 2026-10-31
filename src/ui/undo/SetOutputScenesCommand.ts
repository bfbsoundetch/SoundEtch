import type { OutputScene } from '../../project/OutputScene'
import type { Project } from '../../project/Project'
import { ProjectManager } from '../../project/ProjectManager'
import type { Undoable } from './Undoable'

export class SetOutputScenesCommand implements Undoable {
  private readonly oldScenes: OutputScene[]
  private readonly newScenes: OutputScene[]

  constructor(
    private readonly project: Project,
    oldScenes: readonly OutputScene[],
    newScenes: readonly OutputScene[],
    private readonly description = 'change output scene',
  ) {
    this.oldScenes = copyScenes(oldScenes)
    this.newScenes = copyScenes(newScenes)
  }

  async perform() {
    this.project.outputScenes = copyScenes(this.newScenes)
  }

  async undo() {
    this.project.outputScenes = copyScenes(this.oldScenes)
  }

  async save() {
    await ProjectManager.saveProject(this.project)
  }

  toString() {
    return this.description
  }
}

function copyScenes(scenes: readonly OutputScene[]): OutputScene[] {
  return scenes.map((scene): OutputScene => ({ ...scene, tracks: [...scene.tracks] }))
}
