import { Logger } from '../global/Logger'

const enum Level {
  ERROR = 5000,
  LONG = 6000,
  SHORT = 3000,
}

export class Notification {
  private timeout
  private finished = false

  constructor(
    private element: HTMLDivElement,
    private message: string,
    private readonly level: Level,
  ) {
    this.renderElement()
    this.timeout = this.startTimeout()
  }

  updateElement(element: HTMLDivElement) {
    if (this.finished) {
      return
    }
    this.element = element
    this.renderElement()
  }

  updateMessage(message: string) {
    if (this.finished) {
      return
    }
    this.message = message
    clearTimeout(this.timeout)
    this.renderElement()
    this.timeout = this.startTimeout()
  }

  remove() {
    this.element.style.opacity = '0'
    clearTimeout(this.timeout)
    this.finished = true
  }

  isFinished() {
    return this.finished
  }

  private startTimeout(): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      this.remove()
    }, this.level)
  }

  private renderElement() {
    this.element.style.opacity = '1'
    this.element.className = this.level == Level.ERROR ? 'notification-error' : 'notification-info'
    this.element.innerHTML = ''

    const messageElement = document.createElement('span')
    messageElement.innerText = this.message
    messageElement.className = 'notification-message'
    this.element.appendChild(messageElement)

    const closeButton = document.createElement('button')
    closeButton.className = 'notification-close'
    closeButton.innerText = '×'
    closeButton.type = 'button'
    closeButton.setAttribute('aria-label', 'Dismiss notification')
    closeButton.onclick = () => this.remove()
    this.element.appendChild(closeButton)
  }
}

export class NotificationsController {
  private size = 4
  private readonly parent = document.getElementById('notification-parent') as HTMLDivElement
  private readonly htmlElements = new Array(this.size).fill(null).map((_) => {
    const element = document.createElement('div')
    element.style.opacity = '0'
    this.parent.appendChild(element)
    return element
  })
  private readonly notifications = new Array<Notification>(this.size)
  private readonly logger = new Logger('notification')

  constructor() {
    if (!this.parent.matches(':popover-open')) {
      this.parent.showPopover()
    }
  }

  showError(message: string): Notification {
    this.logger.error(message)
    return this.showInternal(message, Level.ERROR)
  }

  showLongDurationMessage(message: string): Notification {
    this.logger.log(message)
    return this.showInternal(message, Level.LONG)
  }

  showShortDurationMessage(message: string): Notification {
    this.logger.log(message)
    return this.showInternal(message, Level.SHORT)
  }

  private showInternal(message: string, level: Level): Notification {
    for (let i = this.size - 1; i > 0; --i) {
      this.notifications[i] = this.notifications[i - 1]
      if (this.notifications[i] && !this.notifications[i]?.isFinished()) {
        this.notifications[i].updateElement(this.htmlElements[i])
      }
    }
    
    const notif = new Notification(this.htmlElements[0], message, level)
    this.notifications[0] = notif
    // put the notifications above any modals
    this.parent.parentElement!.appendChild(this.parent)
    this.parent.showPopover()
    return notif
  }
}
