import { cloneOutputScene, type OutputScene } from '../../project/OutputScene'
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
    this.oldScenes = oldScenes.map(cloneOutputScene)
    this.newScenes = newScenes.map(cloneOutputScene)
  }

  async perform() {
    this.project.outputScenes = this.newScenes.map(cloneOutputScene)
  }

  async undo() {
    this.project.outputScenes = this.oldScenes.map(cloneOutputScene)
  }

  async save() {
    await ProjectManager.saveProject(this.project)
  }

  toString() {
    return this.description
  }
}
