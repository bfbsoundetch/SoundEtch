export function getAllGetterSetters(object: any) {
  const methods = new Array<string>()
  let current = object

  while (current) {
    Object.getOwnPropertyNames(current).forEach((prop) => {
      if (prop === '__proto__') {
        return
      }
      const isGetter = typeof Object.getOwnPropertyDescriptor(current, prop)!.get === 'function'
      if (isGetter && !methods.includes(prop)) {
        methods.push(prop)
      }
    })
    current = Object.getPrototypeOf(current)
  }

  return methods
}

export function cloneWithGetters(object: any) {
  const result = structuredClone(object)
  getAllGetterSetters(object).forEach((k) => {
    result[k] = object[k]
  })
  return result
}
