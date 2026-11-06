import 'fake-indexeddb/auto'
import { DatabasePersisted } from './DatabasePersisted'
import { DatabasePersister } from './DatabasePersister'
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
  expect(savedFirst.id).toBe(3)

  const one = (await DatabasePersister.getObjectById(1)) as SimplePersisted
  expect(one.name).toBe('scooter')
  expect(one.worthless).toBeDefined()
  const two = (await DatabasePersister.getObjectById(2)) as SimplePersisted
  expect(two.name).toBe('trendy')
  expect(two.worthless).toBeDefined()
  const three = (await DatabasePersister.getObjectById(3)) as SimplePersisted
  expect(three.name).toBe('friend')
  expect(three.worthless).toBeDefined()

  const restored = await DatabasePersister.fromPersistedObject(three)
  expect(restored.children.map((child: SimplePersisted) => child.name)).toEqual(['scooter', 'trendy'])
})

test('a transaction aborted after its save request succeeds is not exposed as a saved object', async () => {
  const put = IDBObjectStore.prototype.put
  const abortingPut = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(
    function (this: IDBObjectStore, value, key) {
      const request = put.call(this, value, key)
      request.addEventListener('success', () => this.transaction.abort(), { once: true })
      return request
    },
  )
  const object = new SimplePersisted('aborted recording metadata')
  try {
    await expect(DatabasePersister.save(object)).rejects.toThrow()
    expect(object.id).toBeUndefined()
  } finally {
    abortingPut.mockRestore()
  }
  const saved = await DatabasePersister.getObjectsByRestorationName<SimplePersisted>('Simple')
  expect(saved.map((entry) => entry.name)).not.toContain(object.name)
  const next = await DatabasePersister.save(new SimplePersisted('committed recording metadata'))
  expect((await DatabasePersister.getObjectById<SimplePersisted>(next.id!))?.name).toBe(next.name)
})
