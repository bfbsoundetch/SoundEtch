type Constructor = { new (...args: any[]): {} }

export function Restorable(restorationName: string) {
  return function <T extends Constructor>(constructor: T) {
    Restoration.restorationFunctions.set(restorationName, constructor)
    return class extends constructor {
      restorationName = restorationName
    }
  }
}

export class Restoration {
  static readonly restorationFunctions = new Map<string, Constructor>()
}
