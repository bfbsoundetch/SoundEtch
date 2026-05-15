export class KeyPressController {
  static keysPressed = new Set<string>()
  static ctrlPressed = false
  static metaPressed = false
  static shiftPressed = false

  static keyListeners = new Set<() => any>()
  static keyDownListeners = new Set<(event: KeyboardEvent) => any>()

  static {
    document.addEventListener('keydown', (event) => {
      this.ctrlPressed = event.ctrlKey
      this.metaPressed = event.metaKey
      this.shiftPressed = event.shiftKey
      this.keysPressed.add(event.code)
      this.keyDownListeners.forEach((l) => l(event))
      this.keyListeners.forEach((l) => l())
    })
    document.addEventListener('keyup', (event) => {
      this.ctrlPressed = event.ctrlKey
      this.metaPressed = event.metaKey
      this.shiftPressed = event.shiftKey
      this.keysPressed.delete(event.code)
      this.keyListeners.forEach((l) => l())
    })
  }

  static addKeyDownListener(listener: (event: KeyboardEvent) => any) {
    this.keyDownListeners.add(listener)
    return () => this.keyDownListeners.delete(listener)
  }
}
