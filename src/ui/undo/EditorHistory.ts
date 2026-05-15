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
    this.backStack.clear()
  }

  private async run(operation: () => Promise<void>): Promise<void> {
    if (this.running) {
      return
    }
    this.running = true
    try {
      await operation()
      await Promise.all([...this.changeListeners].map((listener) => listener()))
    } finally {
      this.running = false
    }
  }
}

export const editorHistory = new EditorHistory()
