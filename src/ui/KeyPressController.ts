export class KeyPressController {
  static keysPressed = new Set<string>()
  static metaPressed = false
  static shiftPressed = false

  static keyListeners = new Set<() => any>()

  static {
    document.addEventListener('keydown', (event) => {
      this.metaPressed = event.metaKey
      this.shiftPressed = event.shiftKey
      this.keysPressed.add(event.code)
      this.keyListeners.forEach((l) => l())
    })
    document.addEventListener('keyup', (event) => {
      this.metaPressed = event.metaKey
      this.shiftPressed = event.shiftKey
      this.keysPressed.delete(event.code)
      this.keyListeners.forEach((l) => l())
    })
  }
}
