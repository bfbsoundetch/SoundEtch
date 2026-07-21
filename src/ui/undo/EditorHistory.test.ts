import { EditorHistory } from './EditorHistory'
import { Undoable } from './Undoable'

test('queues edits instead of dropping edits made during a save', async () => {
  const history = new EditorHistory()
  const calls: string[] = []
  let releaseFirst!: () => void
  const firstCanFinish = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })
  const first: Undoable = {
    async perform() {
      calls.push('first perform')
      await firstCanFinish
    },
    async undo() {},
    async save() {
      calls.push('first save')
    },
  }
  const second: Undoable = {
    async perform() {
      calls.push('second perform')
    },
    async undo() {},
    async save() {
      calls.push('second save')
    },
  }

  const firstExecution = history.execute(first)
  await Promise.resolve()
  const secondExecution = history.execute(second)
  releaseFirst()
  await Promise.all([firstExecution, secondExecution])

  expect(calls).toEqual(['first perform', 'first save', 'second perform', 'second save'])
  expect(history.canUndo).toBe(true)
})

test('queues undo requested while an edit is saving', async () => {
  const history = new EditorHistory()
  let releaseSave!: () => void
  const saveCanFinish = new Promise<void>((resolve) => {
    releaseSave = resolve
  })
  let value = 0
  const command: Undoable = {
    async perform() {
      value = 1
    },
    async undo() {
      value = 0
    },
    async save() {
      await saveCanFinish
    },
  }

  const execution = history.execute(command)
  await Promise.resolve()
  const undo = history.undo()
  releaseSave()
  await Promise.all([execution, undo])

  expect(value).toBe(0)
  expect(history.canUndo).toBe(false)
  expect(history.canRedo).toBe(true)
})

test('rolls back an edit when persistence fails', async () => {
  const history = new EditorHistory()
  let value = 0
  const command: Undoable = {
    async perform() {
      value = 1
    },
    async undo() {
      value = 0
    },
    async save() {
      throw new Error('save failed')
    },
  }

  await expect(history.execute(command)).rejects.toThrow('save failed')
  expect(value).toBe(0)
  expect(history.canUndo).toBe(false)
})
