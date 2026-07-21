import { DatabasePersisted } from './DatabasePersisted'
import { Restoration } from './Restoration'

export class DatabasePersister {
  private static readonly OPAQUE_VALUE_KEY = '__soundetchOpaqueValue'
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
    if (DatabasePersister.isStructuredCloneValue(target)) {
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
      if (target.dbPersisted && Array.isArray(target.ignoredFields) && target.ignoredFields.includes(key)) {
        continue
      }

      objectToPersist[key] = target.wamPluginEffect && key == 'state'
        ? { [DatabasePersister.OPAQUE_VALUE_KEY]: true, value: target[key] }
        : DatabasePersister.toPersistedObject(target[key], false)
    }
    return objectToPersist
  }

  static async fromPersistedObject(object: any): Promise<any> {
    if (!object || typeof object !== 'object') {
      return object
    }
    if (DatabasePersister.isStructuredCloneValue(object)) {
      return object
    }
    if (object[DatabasePersister.OPAQUE_VALUE_KEY] === true && Object.keys(object).length == 2) {
      return object.value
    }
    if (Array.isArray(object)) {
      const result = new Array<any>(object.length)
      for (let i = 0; i < object.length; ++i) {
        result[i] = await DatabasePersister.fromPersistedObject(object[i])
      }
      return result
    }
    if (Object.keys(object).length == 1 && object.i) {
      return DatabasePersister.getObjectById(object.i)
    }
    const constructorFunction = Restoration.restorationFunctions.get(object.restorationName)
    const objectToReturn: any = constructorFunction ? new constructorFunction() : {}
    for (const key of Object.keys(object)) {
      objectToReturn[key] = await DatabasePersister.fromPersistedObject(object[key])
    }
    return objectToReturn
  }

  private static isStructuredCloneValue(value: any) {
    return (
      value instanceof ArrayBuffer ||
      ArrayBuffer.isView(value) ||
      value instanceof Blob ||
      value instanceof Date ||
      value instanceof Map ||
      value instanceof Set
    )
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
