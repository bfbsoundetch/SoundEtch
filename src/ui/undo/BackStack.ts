import { Undoable } from './Undoable'

export class BackStack {
  position = 0
  readonly stack = new Array<Undoable>()

  async pushAndExecute(undoable: Undoable) {
    this.stack.splice(this.position)
    this.stack.push(undoable)
    ++this.position
    await undoable.perform()
    await undoable.save()
  }

  async undo() {
    await this.stack[this.position].undo()
    await this.stack[this.position].save()
    --this.position
  }

  async redo() {
    if (this.position >= this.stack.length) {
      return
    }
    await this.stack[this.position].perform()
    await this.stack[this.position].save()
    ++this.position
  }
}
