import { Member, RemoteMediaClient2, State } from '../remote/RemoteMediaClient2'
import { AudioControl, AudioState } from '../audiocontext/AudioControl'
import { MediaStreamButtonController } from './MediaStreamButtonController'
import { PeakMeterController } from './PeakMeterController'
import { Direction, ErrorBubbleController } from './ErrorBubbleController'
import { NotificationsController } from './NotificationsController'
import { AudioInputs } from '../audioinputs/AudioInputs'
import { AudioInput } from '../audioinputs/AudioInput'
import { LocalMediaStreams } from '../mediastreams/LocalMediaStreams'
import { Logger } from '../global/Logger'

type VideoLayout = 'spotlight' | 'solo' | 'grid'

export class MeetingRoomController {
  private videoLayout: VideoLayout = 'grid'
  private centralVideoIndex = 0
  private usernameForm = document.getElementById('username-form') as HTMLFormElement
  private currentState: State = { members: [], amInRoom: false }
  private remoteMediaClient = new RemoteMediaClient2(btoa(Math.random().toString().slice(10)))

  private readonly usernameErrorBubble = new ErrorBubbleController(this.usernameForm.parentElement as HTMLDivElement)
  private readonly createMeetingErrorBubble = new ErrorBubbleController(
    document.getElementById('create-meeting-button') as HTMLDivElement,
  )
  private readonly notificationsController = new NotificationsController()
  private readonly micButtonController: MediaStreamButtonController
  private readonly videoButtonController: MediaStreamButtonController
  private readonly logger = new Logger('MeetingRoomController')

  private readonly selfVideoElement = document.getElementById('self-vid') as HTMLVideoElement
  private readonly selfAudioElement = document.getElementById('self-meeting-peak') as HTMLDivElement
  private selfPeakMeter: PeakMeterController | null = null

  constructor() {
    this.remoteMediaClient.addStateListener((state: State) => this.stateListener(this, state))

    const micButton = document.getElementById('meeting-mic-button')!
    this.micButtonController = new MediaStreamButtonController(micButton, 'audio', false)
    const vidButton = document.getElementById('meeting-camera-button')!
    this.videoButtonController = new MediaStreamButtonController(vidButton, 'video', false)
    this.setUiForDisconnectedState()
    this.applyVideoLayout()
    LocalMediaStreams.registerAVDeviceListener((added, track) => {
      if (track.kind == 'video') {
        if (added) {
          this.selfVideoElement.srcObject = LocalMediaStreams.localAVDeviceMediaStream
        } else {
          this.selfVideoElement.srcObject = null
        }
      } else {
        if (added) {
          this.selfPeakMeter = new PeakMeterController(this.selfAudioElement, AudioInputs.localAVDevice!, false)
          this.selfPeakMeter.draw(this.selfPeakMeter)
          this.selfAudioElement.style.display = 'inline-block'
        } else {
          this.selfPeakMeter!.remove()
          this.selfPeakMeter!.stop()
          this.selfPeakMeter = null
          this.selfAudioElement.style.display = 'none'
        }
      }
    })
    this.selfVideoElement.style.transform = 'scale(-1,1)'
    this.selfVideoElement.poster = this.getSvgPosterForUser('You', true)
    this.selfVideoElement.onloadedmetadata = () => {
      this.selfVideoElement.play()
    }
    document.addEventListener('click', (event) => {
      const layoutSelector = document.getElementById('meeting-layout-selector')
      if (!layoutSelector?.contains(event.target as Node)) {
        this.closeLayoutMenu()
      }
    })
    this.updateLayoutSelectionUi()

    // LocalMediaStreams.registerScreenListener((added, mediaStreamTrack) => {
    //   if (added) {
    //     this.state.members.push({
    //       peerId: this.peer.id,
    //       username: this.username,
    //       mediaStream: LocalMediaStreams.localScreenMediaStream,
    //       isScreenShare: true,
    //       isSelf: true,
    //     })
    //   } else {
    //     this.deleteMember(this.peer.id, true)
    //   }
    //   this.notifyStateListeners()
    // })
  }

  async createMeeting(): Promise<boolean> {
    if (await this.remoteMediaClient.amInRoom()) {
      return false
    }
    const username = this.usernameForm.value
    if (!username || (username as string).trim().length == 0) {
      this.usernameErrorBubble.showError('Please enter your name', 2000)
      return false
    }
    this.remoteMediaClient.createRoom()
    return true
  }

  async joinMeeting(): Promise<boolean> {
    if (await this.remoteMediaClient.amInRoom()) {
      return false
    }

    if (window.location.search) {
      const meetingId = new URL(window.location.toString()).searchParams.get('meeting')
      if (meetingId) {
        this.logger.log('About to join ' + meetingId)
        this.remoteMediaClient.joinRoom(meetingId)
      }
      return true
    }
    return false
  }

  async amInRoom(): Promise<boolean> {
    return this.remoteMediaClient.amInRoom()
  }

  toggleLayoutMenu() {
    const layoutMenu = document.getElementById('meeting-layout-menu')
    layoutMenu?.classList.toggle('open')
  }

  closeLayoutMenu() {
    document.getElementById('meeting-layout-menu')?.classList.remove('open')
  }

  selectVideoLayout(layout: VideoLayout) {
    this.videoLayout = layout
    this.closeLayoutMenu()
    this.updateLayoutSelectionUi()
    this.applyVideoLayout()
  }

  applyVideoLayout() {
    const vidsParentElement = document.getElementById('vids')!
    switch (this.videoLayout) {
      case 'spotlight':
        for (let i = 0; i < vidsParentElement.children.length; ++i) {
          const element = vidsParentElement.children.item(i) as HTMLElement
          if (i == this.centralVideoIndex) {
            element.classList.value = 'vidDiv vid-spotlight'
          } else {
            element.classList.value = 'vidDiv vid-unspotlight'
          }
        }
        break
      case 'solo':
        for (let i = 0; i < vidsParentElement.children.length; ++i) {
          const element = vidsParentElement.children.item(i) as HTMLElement
          if (i == this.centralVideoIndex) {
            element.classList.value = 'vidDiv vid-solo'
          } else {
            element.classList.value = 'vidDiv vid-unsolo'
          }
        }
        break
      case 'grid':
        const newFlex = vidsParentElement.children.length < 3 ? '100%' : '50%'
        for (let i = 0; i < vidsParentElement.children.length; ++i) {
          const element = vidsParentElement.children.item(i) as HTMLElement
          element.classList.value = 'vidDiv vid-grid'
        }
        break
    }
    this.updateLayoutSelectionUi()
  }

  spotlightElement(id: string) {
    const vidsParentElement = document.getElementById('vids')!
    const newChildren = []
    const oldChildren = vidsParentElement.childNodes
    for (let i = 0; i < oldChildren.length; ++i) {
      if ((oldChildren.item(i) as Element).id == id) {
        newChildren.push(oldChildren.item(0))
        newChildren.unshift(oldChildren.item(i))
      } else if (i > 0) {
        newChildren.push(oldChildren.item(i))
      }
    }
    vidsParentElement.replaceChildren(...newChildren)
    this.applyVideoLayout()
  }

  disconnect() {
    this.remoteMediaClient.disconnect()
  }

  private async stateListener(meetingRoomController: MeetingRoomController, state: State) {
    if (this.currentState == state) {
      return
    }
    if (this.currentState.amInRoom != state.amInRoom) {
      if (state.amInRoom) {
        this.setUiForConnectedState()
      } else {
        this.setUiForDisconnectedState()
      }
    }
    console.error(JSON.stringify(state))
    const vidsParentElement = document.getElementById('vids') as HTMLDivElement
    const elementIds = new Array<string>()
    const audioContext = await AudioControl.getOrCreateAudioContext(AudioState.MONITORING)
    await audioContext.resume()
    for (const member of state.members) {
      const elementId = member.username + (member.isScreenShare ? '_share' : '_vid')
      elementIds.push(elementId)
      let vidDiv = document.getElementById(elementId)

      let videoElement: HTMLVideoElement
      if (!vidDiv) {
        vidDiv = document.createElement('div')
        vidDiv.setAttribute('class', 'vidDiv')
        vidDiv.addEventListener('click', () => meetingRoomController.spotlightElement(elementId))
        vidDiv.id = elementId
        vidsParentElement.appendChild(vidDiv)

        videoElement = document.createElement('video')
        videoElement.poster = meetingRoomController.getSvgPosterForUser(member.username.substring(0, 1), member.isSelf)
        // mirror and mute your own video feed
        if (member.isSelf) {
          videoElement.muted = true
          if (!member.isScreenShare) {
            videoElement.style.transform = 'scale(-1,1)'
          }
        }
        videoElement.onloadedmetadata = () => {
          videoElement.play()
        }
        vidDiv.appendChild(videoElement)
        videoElement.srcObject = member.mediaStream
      } else {
        videoElement = vidDiv.getElementsByTagName('video').item(0)!
      }

      const divs = vidDiv.getElementsByTagName('div')
      console.error(`${member.username}: ${member.mediaStream.getAudioTracks().length}`)
      if (
        divs.length == 0 &&
        member.mediaStream.getAudioTracks().length > 0 &&
        !member.mediaStream.getAudioTracks()[0].muted
      ) {
        let audioInput: AudioInput
        if (member.isSelf) {
          if (member.isScreenShare) {
            audioInput = AudioInputs.localScreenShare!
          } else {
            audioInput = AudioInputs.localAVDevice!
          }
        } else {
          audioInput = AudioInputs.remoteStreams.get({
            username: member.username,
            isScreenShare: member.isScreenShare,
          })!
        }
        const peakMeterElement = divs.length > 0 ? divs.item(0)! : document.createElement('div')
        const meter = new PeakMeterController(peakMeterElement, audioInput, false)
        meter.draw(meter)
        vidDiv.appendChild(peakMeterElement)
        peakMeterElement.style.height = '100%'
        peakMeterElement.style.width = '2.5rem'
        peakMeterElement.style.fontFamily = 'monospace'
      } else if (
        divs.length > 0 &&
        (member.mediaStream.getAudioTracks().length == 0 || member.mediaStream.getAudioTracks()[0].muted)
      ) {
        vidDiv.removeChild(divs.item(0)!)
      }
    }
    // for (let i = 0; i < vidsParentElement.children.length; ++i) {
    //   const node = vidsParentElement.children[i]
    //   if (!elementIds.includes(node.id)) {
    //     console.log('oh dear ;()' + node.id + ' ' + JSON.stringify(elementIds))
    //     node.remove()
    //   }
    // }
    meetingRoomController.applyVideoLayout()
    this.currentState = state
  }

  private updateUiForMediaStream(div: HTMLDivElement, mediaStream: MediaStream) {
    // div.addEventListener('click', () => this.spotlightElement(div))
  }

  private setUiForDisconnectedState() {
    document.getElementById('meeting-controls')!.style.display = 'none'
    const micButton = document.getElementById('meeting-mic-button')!
    micButton!.remove()
    const meetingControlsDiv = document.getElementById('meeting-device-setup-controls')
    meetingControlsDiv?.appendChild(micButton)
    const cameraButton = document.getElementById('meeting-camera-button')!
    cameraButton!.remove()
    meetingControlsDiv?.appendChild(cameraButton)
    meetingControlsDiv!.style.display = 'flex'
    document.getElementById('meeting-room-setup')!.style.display = 'grid'
    document.getElementById('vids')!.style.height = '60%'
    this.videoLayout = 'solo'
    this.updateLayoutSelectionUi()
  }

  private setUiForConnectedState() {
    const meetingControlsDiv = document.getElementById('meeting-controls')
    document.getElementById('meeting-controls')!.style.display = 'flex'
    const micButton = document.getElementById('meeting-mic-button')!
    micButton!.remove()
    meetingControlsDiv?.appendChild(micButton)
    const cameraButton = document.getElementById('meeting-camera-button')!
    cameraButton!.remove()
    meetingControlsDiv?.appendChild(cameraButton)
    document.getElementById('meeting-device-setup-controls')!.style.display = 'none'
    document.getElementById('meeting-room-setup')!.style.display = 'none'
    document.getElementById('vids')!.style.height = '100%'
    this.videoLayout = 'grid'
    this.updateLayoutSelectionUi()
  }

  private updateLayoutSelectionUi() {
    const options: VideoLayout[] = ['grid', 'spotlight', 'solo']
    for (const option of options) {
      document.getElementById(`meeting-layout-check-${option}`)?.classList.toggle('selected', option == this.videoLayout)
    }
  }

  private getSvgPosterForUser(username: string, isSelf: boolean) {
    const svgString = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><style>svg { background-color:rgb(50, 50, 50); fill: white;}</style><text x="${isSelf ? '-' : ''}50" y="50" font-family="Georgia, Palantino, serif" dominant-baseline="middle" text-anchor="middle" ${isSelf ? 'transform="scale(-1, 1)"' : ''}>${username}</text></svg>`
    return 'data:image/svg+xml,' + encodeURIComponent(svgString)
  }
}
