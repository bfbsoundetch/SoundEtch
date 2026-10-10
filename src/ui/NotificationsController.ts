import { Logger } from '../global/Logger'
import { announce } from './LiveAnnouncer'

const enum Level {
  ERROR = 0,
  LONG = 6000,
  SHORT = 3000,
}

export class Notification {
  private timeout: ReturnType<typeof setTimeout> | undefined
  private finished = false

  constructor(
    private element: HTMLDivElement,
    private message: string,
    private readonly level: Level,
  ) {
    this.renderElement()
    this.timeout = this.startTimeout()
    this.announce()
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
    this.announce()
  }

  pause() {
    clearTimeout(this.timeout)
    this.timeout = undefined
  }

  resume() {
    if (!this.finished && this.timeout === undefined) this.timeout = this.startTimeout()
  }

  discard() {
    clearTimeout(this.timeout)
    this.finished = true
  }

  remove() {
    hideNotificationElement(this.element)
    clearTimeout(this.timeout)
    this.finished = true
  }

  isFinished() {
    return this.finished
  }

  private announce() {
    announce(
      this.level == Level.ERROR ? `Error: ${this.message}` : this.message,
      this.level == Level.ERROR ? 'assertive' : 'polite',
    )
  }

  private startTimeout(): ReturnType<typeof setTimeout> | undefined {
    if (this.level == Level.ERROR) return undefined
    return setTimeout(() => {
      this.remove()
    }, this.level)
  }

  private renderElement() {
    this.element.style.opacity = '1'
    this.element.inert = false
    this.element.style.pointerEvents = 'all'
    this.element.className = this.level == Level.ERROR ? 'notification-error' : 'notification-info'
    this.element.innerHTML = ''

    const messageElement = document.createElement('span')
    messageElement.innerText = this.message
    messageElement.className = 'notification-message'
    if (this.level == Level.ERROR) {
      const prefix = document.createElement('strong')
      prefix.textContent = 'Error: '
      messageElement.prepend(prefix)
    }
    this.element.appendChild(messageElement)

    const closeButton = document.createElement('button')
    closeButton.className = 'notification-close'
    closeButton.innerText = '×'
    closeButton.type = 'button'
    closeButton.setAttribute('aria-label', 'Dismiss notification')
    closeButton.onclick = () => this.remove()
    closeButton.onfocus = () => this.pause()
    closeButton.onblur = () => this.resume()
    this.element.onmouseenter = () => this.pause()
    this.element.onmouseleave = () => this.resume()
    this.element.appendChild(closeButton)
  }
}

function hideNotificationElement(element: HTMLDivElement) {
  element.style.opacity = '0'
  element.inert = true
  element.style.pointerEvents = 'none'
}

export class NotificationsController {
  private static instance: NotificationsController | null = null

  private static getInstance() {
    return this.instance ?? (this.instance = new NotificationsController())
  }

  private size = 4
  private readonly parent = document.getElementById('notification-parent') as HTMLDivElement
  private readonly htmlElements = new Array(this.size).fill(null).map((_) => {
    const element = document.createElement('div')
    element.style.opacity = '0'
    element.inert = true
    this.parent.appendChild(element)
    return element
  })
  private readonly notifications = new Array<Notification>(this.size)
  private static readonly logger = new Logger('notification')

  private constructor() {
    if (!this.parent.matches(':popover-open')) {
      this.parent.showPopover()
    }
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return
      for (const notification of this.notifications) {
        if (notification && !notification.isFinished()) notification.remove()
      }
    })
  }

  static showError(e: Error): Notification {
    this.logger.error(e)
    return this.getInstance().showInternal(e.message, Level.ERROR)
  }

  static showErrorMessage(message: string): Notification {
    this.logger.errorMessage(message)
    return this.getInstance().showInternal(message, Level.ERROR)
  }

  static showLongDurationMessage(message: string): Notification {
    this.logger.log(message)
    return this.getInstance().showInternal(message, Level.LONG)
  }

  static showShortDurationMessage(message: string): Notification {
    this.logger.log(message)
    return this.getInstance().showInternal(message, Level.SHORT)
  }

  private showInternal(message: string, level: Level): Notification {
    this.notifications[this.size - 1]?.discard()
    for (let i = this.size - 1; i > 0; --i) {
      this.notifications[i] = this.notifications[i - 1]
      if (this.notifications[i] && !this.notifications[i]?.isFinished()) {
        this.notifications[i].updateElement(this.htmlElements[i])
      } else {
        // A finished or empty slot must not keep showing the message that was rendered here before the shift.
        hideNotificationElement(this.htmlElements[i])
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
