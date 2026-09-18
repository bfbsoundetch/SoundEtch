import type { DatabasePersisted } from './DatabasePersisted'
import { Restoration } from './Restoration'
import { isObjectRecord } from '../global/TypeGuards'

export type PersistedObject = Record<string, unknown> & { id: number }

export interface ImportedObjectGraph {
  readonly idMap: ReadonlyMap<number, number>
  readonly importedIds: readonly number[]
}

export class DatabasePersister {
  private static objectCache = new Map<number, any>()

  private static dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const dbRequest = indexedDB.open('soundetch', 1)
    dbRequest.onsuccess = () => {
      resolve(dbRequest.result)
    }
    dbRequest.onupgradeneeded = () => {
      dbRequest.result.createObjectStore('objects', {
        keyPath: 'id',
        autoIncrement: true,
      })
      dbRequest.result.createObjectStore('global_properties', {
        keyPath: 'key',
      })
    }
    dbRequest.onerror = () => {
      reject(dbRequest.error)
    }
  })

  static async getObjectById<T extends DatabasePersisted>(id: number): Promise<T | null> {
    if (DatabasePersister.objectCache.has(id)) {
      return Promise.resolve(DatabasePersister.objectCache.get(id))
    }
    const db = await this.dbPromise
    const objectStore = db.transaction('objects', 'readonly').objectStore('objects')
    const getRequest = objectStore.get(id)
    return new Promise<T | null>((resolve, reject) => {
      getRequest.onsuccess = async () => {
        const result = await DatabasePersister.fromPersistedObject(getRequest.result)
        DatabasePersister.objectCache.set(id, result)
        resolve(result)
      }
      getRequest.onerror = () => {
        reject('persistObject ' + getRequest.error)
      }
    })
  }

  static async getObjectsByRestorationName<T extends DatabasePersisted>(restorationName: string): Promise<T[]> {
    const db = await this.dbPromise
    const objectStore = db.transaction('objects', 'readonly').objectStore('objects')
    const getRequest = objectStore.getAll()
    return new Promise<T[]>((resolve, reject) => {
      getRequest.onsuccess = async () => {
        try {
          const persistedObjects = getRequest.result.filter((object) => object?.restorationName == restorationName)
          const restoredObjects = new Array<T>()
          for (const persistedObject of persistedObjects) {
            const id = persistedObject.id
            const restoredObject = DatabasePersister.objectCache.has(id)
              ? DatabasePersister.objectCache.get(id)
              : await DatabasePersister.fromPersistedObject(persistedObject)
            if (restoredObject) {
              DatabasePersister.objectCache.set(id, restoredObject)
              restoredObjects.push(restoredObject)
            }
          }
          resolve(restoredObjects)
        } catch (error) {
          reject(error)
        }
      }
      getRequest.onerror = () => {
        reject('getObjectsByRestorationName ' + getRequest.error)
      }
    })
  }

  static async getPersistedObjectGraph(rootObjectId: number): Promise<PersistedObject[]> {
    const db = await this.dbPromise
    const objectStore = db.transaction('objects', 'readonly').objectStore('objects')
    const values: unknown[] = await requestResult(objectStore.getAll())
    const objectsById = new Map<number, PersistedObject>()

    for (const value of values) {
      if (!isPersistedObject(value)) {
        throw new Error('The project database contains an invalid object')
      }
      objectsById.set(value.id, value)
    }

    const rootObject = objectsById.get(rootObjectId)
    if (!rootObject) {
      throw new Error('The active project is missing from the project database')
    }

    const result = new Array<PersistedObject>()
    const queuedIds = new Set<number>([rootObjectId])
    const queue = [rootObject]
    for (let index = 0; index < queue.length; ++index) {
      const object = queue[index]
      result.push(object)
      for (const referencedId of getPersistedReferences(object)) {
        if (queuedIds.has(referencedId)) {
          continue
        }
        const referencedObject = objectsById.get(referencedId)
        if (!referencedObject) {
          throw new Error(`Project database object ${object.id} references missing object ${referencedId}`)
        }
        queuedIds.add(referencedId)
        queue.push(referencedObject)
      }
    }
    return result
  }

  static async importPersistedObjectGraph(
    objects: readonly PersistedObject[],
    rootObjectId: number,
  ): Promise<ImportedObjectGraph> {
    if (objects.length == 0) {
      throw new Error('The project archive contains no database objects')
    }

    const objectsById = new Map<number, PersistedObject>()
    for (const object of objects) {
      if (!isPersistedObject(object) || objectsById.has(object.id)) {
        throw new Error('The project archive contains invalid or duplicate database object IDs')
      }
      objectsById.set(object.id, object)
    }
    if (!objectsById.has(rootObjectId)) {
      throw new Error('The project archive is missing its root database object')
    }

    const reachableIds = new Set<number>([rootObjectId])
    const queue = [rootObjectId]
    for (let index = 0; index < queue.length; ++index) {
      const object = objectsById.get(queue[index])!
      for (const referencedId of getPersistedReferences(object)) {
        if (!objectsById.has(referencedId)) {
          throw new Error(`Archived database object ${object.id} references missing object ${referencedId}`)
        }
        if (!reachableIds.has(referencedId)) {
          reachableIds.add(referencedId)
          queue.push(referencedId)
        }
      }
    }
    if (reachableIds.size != objects.length) {
      throw new Error('The project archive contains database objects unrelated to its project')
    }

    const db = await this.dbPromise
    const transaction = db.transaction('objects', 'readwrite')
    const completion = transactionResult(transaction)
    const objectStore = transaction.objectStore('objects')

    try {
      const generatedKeys = await Promise.all(objects.map(() => requestResult(objectStore.add({}))))
      const importedIds = generatedKeys.map((key) => {
        if (typeof key != 'number' || !Number.isSafeInteger(key)) {
          throw new Error('The project database generated an invalid object ID')
        }
        return key
      })
      const idMap = new Map(objects.map((object, index) => [object.id, importedIds[index]]))
      await Promise.all(
        objects.map((object) => {
          const remappedObject = remapPersistedValue(object, idMap)
          if (!isObjectRecord(remappedObject)) {
            throw new Error('The project archive contains an invalid database object')
          }
          const remappedId = idMap.get(object.id)
          if (!remappedId) {
            throw new Error(`The project archive references missing object ${object.id}`)
          }
          remappedObject.id = remappedId
          return requestResult(objectStore.put(remappedObject))
        }),
      )
      await completion
      return { idMap, importedIds }
    } catch (error) {
      try {
        transaction.abort()
      } catch (abortError) {
        if (!(abortError instanceof DOMException) || abortError.name != 'InvalidStateError') {
          throw abortError
        }
      }
      await completion.catch(() => undefined)
      throw error
    }
  }

  static async deleteObjectsByIds(ids: readonly number[]): Promise<void> {
    if (ids.length == 0) {
      return
    }
    const db = await this.dbPromise
    const transaction = db.transaction('objects', 'readwrite')
    const completion = transactionResult(transaction)
    const objectStore = transaction.objectStore('objects')
    await Promise.all(ids.map((id) => requestResult(objectStore.delete(id))))
    await completion
    ids.forEach((id) => DatabasePersister.objectCache.delete(id))
  }

  static async save<T extends DatabasePersisted>(object: T): Promise<T> {
    const objectToPersist = DatabasePersister.toPersistedObject(object, true)
    const db = await this.dbPromise
    const objectStore = db.transaction('objects', 'readwrite').objectStore('objects')
    const now = Date.now()
    if (!objectToPersist.id) {
      objectToPersist.dateCreated = now
      ;(object as any).dateCreated = now
    }
    objectToPersist.dateModified = now
    ;(object as any).dateModified = now
    objectToPersist.version = now
    if (!objectToPersist.id) {
      delete objectToPersist.id
    }
    const request = objectStore.put(objectToPersist)
    return new Promise<any>((resolve, reject) => {
      request.onsuccess = () => {
        ;(object as any).id = request.result
        DatabasePersister.objectCache.set(Number(request.result), object)
        resolve(object)
      }
      request.onerror = () => {
        reject('persistObject ' + request.error)
      }
    })
  }

  static toPersistedObject(target: any, isSelf: boolean): any {
    if (!target || typeof target !== 'object') {
      return target
    }
    if (Array.isArray(target)) {
      return target.map((i) => DatabasePersister.toPersistedObject(i, false))
    }
    if (target['dbPersisted'] && !isSelf) {
      return { i: target.id }
    }
    const objectToPersist: any = {}
    for (const key of Object.keys(target)) {
      if (Array.isArray(target.ignoredFields) && target.ignoredFields.includes(key)) {
        continue
      }

      objectToPersist[key] = DatabasePersister.toPersistedObject(target[key], false)
    }
    return objectToPersist
  }

  static async fromPersistedObject(object: any): Promise<any> {
    if (!object || typeof object !== 'object') {
      return object
    }
    if (Array.isArray(object)) {
      const result = new Array<any>(object.length)
      for (let i = 0; i < object.length; ++i) {
        result[i] = await DatabasePersister.fromPersistedObject(object[i])
      }
      return result
    }
    if (object.i) {
      return DatabasePersister.getObjectById(object.i)
    }
    const constructorFunction = Restoration.restorationFunctions.get(object.restorationName)
    const objectToReturn: any = constructorFunction ? new constructorFunction() : {}
    for (const key of Object.keys(object)) {
      objectToReturn[key] = await DatabasePersister.fromPersistedObject(object[key])
    }
    return objectToReturn
  }

  static async setGlobalProperty(propertyName: string, propertyValue: any): Promise<any> {
    const valueString = DatabasePersister.toString(propertyValue)
    const db = await this.dbPromise
    const objectStore = db.transaction('global_properties', 'readwrite').objectStore('global_properties')
    const request = objectStore.put({ key: propertyName, value: valueString })
    return new Promise<any>((resolve, reject) => {
      request.onsuccess = () => {
        resolve('')
      }
      request.onerror = () => {
        reject('setGlobalProperty ' + request.error)
      }
    })
  }

  static async getGlobalProperty(propertyName: string): Promise<string | null> {
    const db = await this.dbPromise
    const objectStore = db.transaction('global_properties', 'readonly').objectStore('global_properties')
    const getRequest = objectStore.get(propertyName)
    return new Promise<string | null>((resolve, reject) => {
      getRequest.onsuccess = () => {
        if (getRequest.result) {
          resolve(getRequest.result.value)
        } else {
          resolve(null)
        }
      }
      getRequest.onerror = () => {
        reject('persistObject ' + getRequest.error)
      }
    })
  }

  static async deleteObjectById(id: number) {
    const db = await this.dbPromise
    const objectStore = db.transaction('objects', 'readwrite').objectStore('objects')
    const deleteRequest = objectStore.delete(id)
    return new Promise<any>((resolve, reject) => {
      deleteRequest.onsuccess = () => {
        DatabasePersister.objectCache.delete(id)
        resolve('')
      }
      deleteRequest.onerror = () => {
        reject('persistObject ' + deleteRequest.error)
      }
    })
  }

  private static toString(propertyValue: any) {
    switch (typeof propertyValue) {
      case 'string':
      case 'object':
        return JSON.stringify(propertyValue)
      default:
        return String(propertyValue)
    }
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

function transactionResult(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction was aborted'))
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'))
  })
}

function isPersistedObject(value: unknown): value is PersistedObject {
  return isObjectRecord(value) && typeof value.id == 'number' && Number.isSafeInteger(value.id) && value.id > 0
}

function getPersistedReferences(value: unknown): Set<number> {
  const references = new Set<number>()
  const visited = new WeakSet<object>()

  const visit = (candidate: unknown) => {
    if (candidate == null || typeof candidate != 'object' || visited.has(candidate)) {
      return
    }
    visited.add(candidate)
    if (isPersistedReference(candidate)) {
      references.add(candidate.i)
      return
    }
    if (Array.isArray(candidate)) {
      candidate.forEach(visit)
      return
    }
    Object.values(candidate).forEach(visit)
  }

  visit(value)
  return references
}

function isPersistedReference(value: unknown): value is { i: number } {
  if (!isObjectRecord(value) || Object.keys(value).length != 1) {
    return false
  }
  return typeof value.i == 'number' && Number.isSafeInteger(value.i) && value.i > 0
}

function remapPersistedValue(value: unknown, idMap: ReadonlyMap<number, number>): unknown {
  if (isPersistedReference(value)) {
    const remappedId = idMap.get(value.i)
    if (!remappedId) {
      throw new Error(`The project archive references missing object ${value.i}`)
    }
    return { i: remappedId }
  }
  if (Array.isArray(value)) {
    return value.map((item) => remapPersistedValue(item, idMap))
  }
  if (!isObjectRecord(value)) {
    return value
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remapPersistedValue(item, idMap)]))
}
