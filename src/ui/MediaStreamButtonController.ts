import { LocalMediaStreams } from '../mediastreams/LocalMediaStreams'

export class MediaStreamButtonController {
  private readonly iconSvg: SVGSVGElement
  private readonly tooltipElement: HTMLSpanElement | null
  private tooltip: string

  constructor(
    private readonly mainElement: HTMLElement | SVGSVGElement,
    private readonly mediaType: 'audio' | 'video',
    isScreenShare: boolean,
  ) {
    this.iconSvg =
      mainElement.tagName === 'svg' ? (mainElement as SVGSVGElement) : mainElement.getElementsByTagName('svg')[0]!
    this.tooltipElement = mainElement.getElementsByTagName('span')[0]
    this.tooltip = this.tooltipElement.innerText ?? ''
    if (isScreenShare) {
      mainElement.onclick = LocalMediaStreams.startCapturingTab
      LocalMediaStreams.registerScreenListener((added, track) => {
        this.toggleSlashIcon(!added)
        if (added) {
          mainElement.onclick = LocalMediaStreams.endScreenShare
          this.tooltip = 'Disable Tab / Screen Capture'
        } else {
          mainElement.onclick = LocalMediaStreams.startCapturingTab
          this.tooltip = 'Enable Tab / Screen Capture'
        }
        if (this.tooltipElement) {
          this.tooltipElement.innerText = this.tooltip
        }
      })
    } else {
      if (this.mediaType == 'audio') {
        mainElement.onclick = LocalMediaStreams.startAudioDevice
      } else {
        mainElement.onclick = () => LocalMediaStreams.startVideoDevice()
      }
      LocalMediaStreams.registerAVDeviceListener((added, track) => {
        if (track.kind != this.mediaType) {
          return
        }
        this.toggleSlashIcon(!added)
        if (this.mediaType == 'audio') {
          if (added) {
            mainElement.onclick = LocalMediaStreams.endAudioDeviceStream
            this.tooltip = 'Disable Microphone'
          } else {
            mainElement.onclick = LocalMediaStreams.startAudioDevice
            this.tooltip = 'Enable Microphone'
          }
        } else {
          if (added) {
            mainElement.onclick = LocalMediaStreams.endVideoDeviceStream
            this.tooltip = 'Disable Camera'
          } else {
            mainElement.onclick = () => LocalMediaStreams.startVideoDevice()
            this.tooltip = 'Enable Microphone'
          }
        }
        if (this.tooltipElement) {
          this.tooltipElement.innerText = this.tooltip
        }
      })
    }
    this.toggleSlashIcon(true)
  }

  private toggleSlashIcon(add: boolean) {
    this.mainElement.setAttribute('aria-pressed', String(!add))
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
