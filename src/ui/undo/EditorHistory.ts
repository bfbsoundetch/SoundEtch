import { BackStack } from './BackStack'
import { Undoable } from './Undoable'

type ChangeListener = () => Promise<void> | void

export class EditorHistory {
  private readonly backStack = new BackStack()
  private readonly changeListeners = new Set<ChangeListener>()
  private operationQueue = Promise.resolve()

  addChangeListener(listener: ChangeListener) {
    this.changeListeners.add(listener)
    return () => this.changeListeners.delete(listener)
  }

  get canUndo() {
    return this.backStack.canUndo
  }

  get canRedo() {
    return this.backStack.canRedo
  }

  get undoActionString() {
    return this.backStack.undoActionString
  }

  get redoActionString() {
    return this.backStack.redoActionString
  }

  async execute(undoable: Undoable): Promise<void> {
    await this.run(() => this.backStack.execute(undoable))
  }

  async recordApplied(undoable: Undoable): Promise<void> {
    await this.run(() => this.backStack.recordApplied(undoable))
  }

  async undo(): Promise<void> {
    await this.run(async () => {
      if (this.backStack.canUndo) {
        await this.backStack.undo()
      }
    })
  }

  async redo(): Promise<void> {
    await this.run(async () => {
      if (this.backStack.canRedo) {
        await this.backStack.redo()
      }
    })
  }

  clear() {
    return this.run(async () => this.backStack.clear())
  }

  private async run(operation: () => Promise<void>): Promise<void> {
    const result = this.operationQueue.then(async () => {
      await operation()
      await this.notifyChangeListeners()
    })
    this.operationQueue = result.catch(() => {})
    await result
  }

  private async notifyChangeListeners(): Promise<void> {
    await Promise.all([...this.changeListeners].map((listener) => listener()))
  }
}

export const editorHistory = new EditorHistory()
