import type { OutputCaptionSettings } from '../../project/OutputCaptions'
import type { Project } from '../../project/Project'
import { ProjectManager } from '../../project/ProjectManager'
import type { Undoable } from './Undoable'

export class SetOutputCaptionsCommand implements Undoable {
  private readonly before: OutputCaptionSettings
  private readonly after: OutputCaptionSettings

  constructor(
    private readonly project: Project,
    before: Readonly<OutputCaptionSettings>,
    after: Readonly<OutputCaptionSettings>,
  ) {
    this.before = { ...before }
    this.after = { ...after }
  }

  async perform() {
    this.project.outputCaptions = { ...this.after }
  }

  async undo() {
    this.project.outputCaptions = { ...this.before }
  }

  async save() {
    await ProjectManager.saveProject(this.project)
  }

  toString() {
    return 'change output captions'
  }
}
