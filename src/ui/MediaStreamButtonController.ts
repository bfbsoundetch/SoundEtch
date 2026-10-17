import { LocalMediaStreams } from '../mediastreams/LocalMediaStreams'

interface ButtonLabels {
  readonly enable: string
  readonly disable: string
  readonly unavailable: string
}

const MICROPHONE_LABELS: ButtonLabels = {
  enable: 'Enable Microphone',
  disable: 'Disable Microphone',
  unavailable: 'No Microphone Detected',
}
const CAMERA_LABELS: ButtonLabels = {
  enable: 'Enable Camera',
  disable: 'Disable Camera',
  unavailable: 'No Camera Detected',
}
const SCREEN_CAPTURE_LABELS: ButtonLabels = {
  enable: 'Enable Tab / Screen Capture',
  disable: 'Disable Tab / Screen Capture',
  unavailable: 'Tab / Screen Capture Not Supported',
}

export class MediaStreamButtonController {
  private readonly iconSvg: SVGSVGElement
  private readonly tooltipElement: HTMLSpanElement | undefined
  private readonly labels: ButtonLabels
  private active = false
  /** Assumed until detection finishes so the slash doesn't flash on at startup. */
  private available = true
  /** Discards `enumerateDevices()` results that resolve after a newer check started. */
  private deviceCheckId = 0

  constructor(
    private readonly mainElement: HTMLElement | SVGSVGElement,
    private readonly mediaType: 'audio' | 'video',
    isScreenShare: boolean,
  ) {
    this.iconSvg =
      mainElement.tagName === 'svg' ? (mainElement as SVGSVGElement) : mainElement.getElementsByTagName('svg')[0]!
    this.tooltipElement = mainElement.getElementsByTagName('span')[0]
    if (isScreenShare) {
      this.labels = SCREEN_CAPTURE_LABELS
      this.available = !!navigator.mediaDevices?.getDisplayMedia
      // Render before registering listeners: registration replays already-active tracks.
      this.render()
      mainElement.onclick = LocalMediaStreams.startCapturingTab
      LocalMediaStreams.registerScreenListener((added) => {
        mainElement.onclick = added ? LocalMediaStreams.endScreenShare : LocalMediaStreams.startCapturingTab
        this.setActive(added)
      })
    } else {
      this.labels = mediaType == 'audio' ? MICROPHONE_LABELS : CAMERA_LABELS
      this.render()
      void this.updateDeviceAvailability()
      navigator.mediaDevices?.addEventListener('devicechange', () => void this.updateDeviceAvailability())
      const start =
        mediaType == 'audio' ? LocalMediaStreams.startAudioDevice : () => LocalMediaStreams.startVideoDevice()
      const end = mediaType == 'audio' ? LocalMediaStreams.endAudioDeviceStream : LocalMediaStreams.endVideoDeviceStream
      mainElement.onclick = start
      LocalMediaStreams.registerAVDeviceListener((added, track) => {
        if (track.kind != mediaType) {
          return
        }
        mainElement.onclick = added ? end : start
        this.setActive(added)
      })
    }
  }

  private setActive(active: boolean) {
    this.active = active
    this.render()
  }

  /** Before permission is granted, browsers still list one label-less device per kind that exists. */
  private async updateDeviceAvailability() {
    const checkId = ++this.deviceCheckId
    const devices = (await navigator.mediaDevices?.enumerateDevices()) ?? []
    if (checkId != this.deviceCheckId) {
      return
    }
    const kind: MediaDeviceKind = this.mediaType == 'audio' ? 'audioinput' : 'videoinput'
    this.available = devices.some((device) => device.kind == kind)
    this.render()
  }

  private render() {
    this.mainElement.setAttribute('aria-pressed', String(this.active))
    this.toggleSlashIcon(!this.available)
    if (this.tooltipElement) {
      this.tooltipElement.innerText = this.active
        ? this.labels.disable
        : this.available
          ? this.labels.enable
          : this.labels.unavailable
    }
  }

  private toggleSlashIcon(add: boolean) {
    const uses = this.iconSvg.getElementsByTagName('use')
    if (!add && uses.length == 2) {
      this.iconSvg.replaceChildren(uses.item(0)!)
    } else if (add && uses.length == 1) {
      const newElement = document.createElementNS('http://www.w3.org/2000/svg', 'use')
      newElement.setAttributeNS('http://www.w3.org/1999/xlink', 'href', '#slash')
      this.iconSvg.appendChild(newElement)
    }
  }
}
