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
    element.innerText = message
    element.style.opacity = '1'
    element.className = level == Level.ERROR ? 'notification-error' : 'notification-info'
    this.timeout = this.startTimeout()
  }

  updateElement(element: HTMLDivElement) {
    if (this.finished) {
      return
    }
    this.element = element
    element.innerText = this.message
    element.style.opacity = '1'
    element.className = this.level == Level.ERROR ? 'notification-error' : 'notification-info'
  }

  updateMessage(message: string) {
    if (this.finished) {
      return
    }
    this.message = message
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
      this.element.style.opacity = '0'
      this.finished = true
    }, this.level)
  }
}

export class NotificationsController {
  private size = 4
  private readonly htmlElements = new Array(this.size).fill(null).map((_) => {
    const element = document.createElement('div')
    element.style.opacity = '0'
    document.getElementById('notification-parent')!.appendChild(element)
    return element
  })
  private readonly notifications = new Array<Notification>(this.size)
  private readonly logger = new Logger('notification')

  constructor() {}

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
    return notif
  }
}
