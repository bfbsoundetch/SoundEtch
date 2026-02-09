import { DatabasePersisted } from './DatabasePersisted'
import { Restoration } from './Restoration'

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

  static async save<T extends DatabasePersisted>(object: T): Promise<T> {
    const objectToPersist = DatabasePersister.toPersistedObject(object, true)
    const db = await this.dbPromise
    const objectStore = db.transaction('objects', 'readwrite').objectStore('objects')
    objectToPersist.version = Date.now()
    if (!objectToPersist.id) {
      delete objectToPersist.id
    }
    const request = objectStore.put(objectToPersist)
    return new Promise<any>((resolve, reject) => {
      request.onsuccess = () => {
        ;(object as any).id = request.result
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
