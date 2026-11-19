// Cloud credentials and backup progress. Kept apart from the `soundetch` database, whose unguarded upgrade would need a
// version bump for a new store.
const DATABASE_NAME = 'soundetch-cloud'
const STORE_NAME = 'records'

let database: Promise<IDBDatabase> | null = null

function openDatabase(): Promise<IDBDatabase> {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: 'key' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  }).catch((error: unknown) => {
    database = null
    throw error
  })
  return database
}

function completion(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () =>
      reject(transaction.error ?? new DOMException('The transaction was aborted', 'AbortError'))
    transaction.onerror = () => reject(transaction.error)
  })
}

export async function getRecord<T>(key: string): Promise<T | undefined> {
  const transaction = (await openDatabase()).transaction(STORE_NAME, 'readonly')
  const request = transaction.objectStore(STORE_NAME).get(key)
  await completion(transaction)
  return request.result as T | undefined
}

export async function putRecord<T extends { key: string }>(record: T): Promise<void> {
  const transaction = (await openDatabase()).transaction(STORE_NAME, 'readwrite', { durability: 'strict' })
  transaction.objectStore(STORE_NAME).put(record)
  await completion(transaction)
}

export async function deleteRecord(key: string): Promise<void> {
  const transaction = (await openDatabase()).transaction(STORE_NAME, 'readwrite', { durability: 'strict' })
  transaction.objectStore(STORE_NAME).delete(key)
  await completion(transaction)
}
