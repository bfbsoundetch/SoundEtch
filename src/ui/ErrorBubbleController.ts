export enum Direction {
  UP,
  RIGHT,
  DOWN,
  LEFT,
}

export class ErrorBubbleController {
  private readonly errorSpan: HTMLSpanElement
  private timeout: number | null = null

  constructor(private readonly parentDiv: HTMLDivElement) {
    this.errorSpan = document.createElement('span')
    this.errorSpan.className = 'error-span'
    this.errorSpan.style.opacity = '0'
    this.parentDiv.appendChild(this.errorSpan)
  }

  showError(message: string, timeoutMs: number = 0, direction: Direction = Direction.UP) {
    const errorSpan = this.errorSpan
    if (this.timeout) {
      clearTimeout(this.timeout)
      this.timeout = null
    }

    switch (direction) {
      case Direction.UP:
        errorSpan.style.width = '100%'
        errorSpan.style.bottom = '100%'
        errorSpan.style.left = '0'
        errorSpan.style.marginBottom = '5px'
        break
      case Direction.RIGHT:
        errorSpan.style.height = '100%'
        errorSpan.style.bottom = '0'
        errorSpan.style.left = '0'
        errorSpan.style.translate = '-100%'
        errorSpan.style.marginLeft = '5px'
        break
      case Direction.DOWN:
        errorSpan.style.width = '100%'
        errorSpan.style.top = '100%'
        errorSpan.style.left = '0'
        errorSpan.style.marginTop = '5px'
        break
      case Direction.LEFT:
        errorSpan.style.height = '100%'
        errorSpan.style.bottom = '0'
        errorSpan.style.right = '0'
        errorSpan.style.translate = '100%'
        errorSpan.style.marginRight = '5px'
        break
    }
    errorSpan.innerText = message
    errorSpan.style.opacity = '1'

    if (timeoutMs > 0) {
      this.timeout = setTimeout(() => {
        this.errorSpan.style.opacity = '0'
      }, timeoutMs) as unknown as number
    }
  }
}
