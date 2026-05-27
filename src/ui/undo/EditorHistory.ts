import { BackStack } from './BackStack'
import { Undoable } from './Undoable'

type ChangeListener = () => Promise<void> | void

export class EditorHistory {
  private readonly backStack = new BackStack()
  private readonly changeListeners = new Set<ChangeListener>()
  private running = false

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
    if (!this.backStack.canUndo) {
      return
    }
    await this.run(() => this.backStack.undo())
  }

  async redo(): Promise<void> {
    if (!this.backStack.canRedo) {
      return
    }
    await this.run(() => this.backStack.redo())
  }

  clear() {
    const hadChanges = this.canUndo || this.canRedo
    this.backStack.clear()
    if (hadChanges) {
      void this.notifyChangeListeners().catch((error) => console.error(error))
    }
  }

  private async run(operation: () => Promise<void>): Promise<void> {
    if (this.running) {
      return
    }
    this.running = true
    try {
      await operation()
      await this.notifyChangeListeners()
    } finally {
      this.running = false
    }
  }

  private async notifyChangeListeners(): Promise<void> {
    await Promise.all([...this.changeListeners].map((listener) => listener()))
  }
}

export const editorHistory = new EditorHistory()
