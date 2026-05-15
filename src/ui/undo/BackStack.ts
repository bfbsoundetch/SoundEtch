import { Undoable } from './Undoable'

export class BackStack {
  private position = 0
  private readonly stack = new Array<Undoable>()

  get canUndo() {
    return this.position > 0
  }

  get canRedo() {
    return this.position < this.stack.length
  }

  async execute(undoable: Undoable): Promise<void> {
    await undoable.perform()
    await undoable.save()
    this.stack.splice(this.position)
    this.stack.push(undoable)
    ++this.position
  }

  async recordApplied(undoable: Undoable): Promise<void> {
    await undoable.save()
    this.stack.splice(this.position)
    this.stack.push(undoable)
    ++this.position
  }

  async undo(): Promise<void> {
    if (!this.canUndo) {
      return
    }
    const undoable = this.stack[this.position - 1]
    await undoable.undo()
    await undoable.save()
    --this.position
  }

  async redo(): Promise<void> {
    if (!this.canRedo) {
      return
    }
    const undoable = this.stack[this.position]
    await undoable.perform()
    await undoable.save()
    ++this.position
  }

  clear() {
    this.stack.splice(0)
    this.position = 0
  }
}
