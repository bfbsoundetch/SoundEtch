import { LocalMediaStreams } from '../mediastreams/LocalMediaStreams'

export class MediaStreamButtonController {
  private readonly iconSvg: SVGSVGElement

  constructor(
    mainElement: HTMLElement | SVGSVGElement,
    private readonly mediaType: 'audio' | 'video',
    isScreenShare: boolean,
  ) {
    this.iconSvg =
      mainElement.tagName === 'svg' ? (mainElement as SVGSVGElement) : mainElement.getElementsByTagName('svg')[0]!
    if (isScreenShare) {
      mainElement.onclick = LocalMediaStreams.startCapturingTab
      LocalMediaStreams.registerScreenListener((added, track) => {
        this.toggleSlashIcon(added)
        if (added) {
          mainElement.style.backdropFilter = 'brightness(.75)'
          mainElement.onclick = LocalMediaStreams.endScreenShare
        } else {
          mainElement.style.backdropFilter = ''
          mainElement.onclick = LocalMediaStreams.startCapturingTab
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
        if (added) {
          mainElement.style.backdropFilter = 'brightness(.75)'
        } else {
          mainElement.style.backdropFilter = ''
        }
        this.toggleSlashIcon(added)
        if (this.mediaType == 'audio') {
          if (added) {
            mainElement.onclick = LocalMediaStreams.endAudioDeviceStream
          } else {
            mainElement.onclick = LocalMediaStreams.startAudioDevice
          }
        } else {
          if (added) {
            mainElement.onclick = LocalMediaStreams.endVideoDeviceStream
          } else {
            mainElement.onclick = () => LocalMediaStreams.startVideoDevice()
          }
        }
      })
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
