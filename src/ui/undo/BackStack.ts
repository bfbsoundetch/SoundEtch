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

  get undoActionString() {
    return this.canUndo ? String(this.stack[this.position - 1]) : null
  }

  get redoActionString() {
    return this.canRedo ? String(this.stack[this.position]) : null
  }

  async execute(undoable: Undoable): Promise<void> {
    await undoable.perform()
    try {
      await undoable.save()
    } catch (error) {
      await undoable.undo()
      throw error
    }
    this.stack.splice(this.position)
    this.stack.push(undoable)
    ++this.position
  }

  async recordApplied(undoable: Undoable): Promise<void> {
    try {
      await undoable.save()
    } catch (error) {
      await undoable.undo()
      throw error
    }
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
    try {
      await undoable.save()
    } catch (error) {
      await undoable.perform()
      throw error
    }
    --this.position
  }

  async redo(): Promise<void> {
    if (!this.canRedo) {
      return
    }
    const undoable = this.stack[this.position]
    await undoable.perform()
    try {
      await undoable.save()
    } catch (error) {
      await undoable.undo()
      throw error
    }
    ++this.position
  }

  clear() {
    this.stack.splice(0)
    this.position = 0
  }
}
