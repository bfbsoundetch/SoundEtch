import indexedDB from 'fake-indexeddb'
globalThis.indexedDB = indexedDB
import { DatabasePersisted } from './DatabasePersisted'
import { DatabasePersister } from './DatabasePersister'
import 'fake-indexeddb/auto'
import { Restorable } from './Restoration'

@Restorable('Simple')
class SimplePersisted extends DatabasePersisted {
  readonly children = new Array<DatabasePersisted>()

  constructor(readonly name: string) {
    super([])
  }

  worthless() {}
}

test('myTest', async () => {
  const first = new SimplePersisted('friend')
  const second = new SimplePersisted('scooter')
  const third = new SimplePersisted('trendy')

  first.children.push(second)
  first.children.push(third)

  await DatabasePersister.save(second)
  await DatabasePersister.save(third)
  const savedFirst = await DatabasePersister.save(first)
  console.log(savedFirst)

  savedFirst.children.push(first)

  const one = (await DatabasePersister.getObjectById(1)) as SimplePersisted
  expect(one.name).toBe('scooter')
  expect(one.worthless).toBeDefined()
  const two = (await DatabasePersister.getObjectById(2)) as SimplePersisted
  expect(two.name).toBe('trendy')
  expect(two.worthless).toBeDefined()
  const three = (await DatabasePersister.getObjectById(3)) as SimplePersisted
  expect(three.name).toBe('friend')
  expect(three.worthless).toBeDefined()

  console.log(JSON.stringify(await DatabasePersister.fromPersistedObject(three)))

  expect(1).toBe(1)
})
