import { Member, RemoteMediaClient2, State } from '../remote/RemoteMediaClient2'
import { MediaStreamButtonController } from './MediaStreamButtonController'
import { PeakMeterController } from './PeakMeterController'
import { Direction, ErrorBubbleController } from './ErrorBubbleController'
import { NotificationsController } from './NotificationsController'
import { AudioInputs } from '../audioinputs/AudioInputs'
import { AudioInput } from '../audioinputs/AudioInput'
import { LocalMediaStreams } from '../mediastreams/LocalMediaStreams'
import { Logger } from '../global/Logger'

enum VideoLayout {
  SPOTLIGHT = 'spotlight',
  SOLO = 'solo',
  GRID = 'grid'
}

class VideoContainer {

  private peakMeter: PeakMeterController | null = null
  isActive = false

  constructor(
    readonly divElement: HTMLDivElement, 
    readonly vidElement: HTMLVideoElement,
    meetingRoomController: MeetingRoomController,
    readonly audioElement: HTMLDivElement | null = null,
  ) {
    this.vidElement.onloadedmetadata = () => {
      this.vidElement.play()
    }
    this.divElement.onclick = () => meetingRoomController.spotlightElement(this)
  }

  startPeakMeter(audioInput: AudioInput) {
    if (!this.audioElement) {
      return null
    }
    if (!this.peakMeter) {
      this.peakMeter = new PeakMeterController(this.audioElement, audioInput)
    }
    this.peakMeter!.draw(this.peakMeter!)
    this.audioElement!.style.display = 'inline-block'
  }

  stopPeakMeter() {
    if (!this.peakMeter) {
      return
    }
    this.peakMeter.remove()
    this.peakMeter.stop()
    this.peakMeter = null
    this.audioElement!.style.display = 'none'
  }
}

export class MeetingRoomController {
  private videoLayout = VideoLayout.GRID
  private usernameForm = document.getElementById('username-form') as HTMLFormElement
  private currentState: State = { members: [], roomName: null, screenShare: null, error: null }
  private remoteMediaClient: RemoteMediaClient2 | null = null

  private readonly usernameErrorBubble = new ErrorBubbleController('MeetingUsername', this.usernameForm.parentElement as HTMLDivElement)
  private readonly createMeetingErrorBubble = new ErrorBubbleController(
    'CreateMeetingButton',
    document.getElementById('create-meeting-button') as HTMLDivElement,
  )
  private readonly notificationsController = new NotificationsController()
  private readonly micButtonController: MediaStreamButtonController
  private readonly videoButtonController: MediaStreamButtonController
  private readonly logger = new Logger('MeetingRoomController')

  private readonly selfVideoContainer = new VideoContainer(
    document.getElementById('self-meeting') as HTMLDivElement,
    document.getElementById('self-vid') as HTMLVideoElement,
    this,
    document.getElementById('self-meeting-peak') as HTMLDivElement,
  )

  private readonly screenVideoContainer = new VideoContainer(
    document.getElementById('screen-share-meeting') as HTMLDivElement,
    document.getElementById('screen-share-vid') as HTMLVideoElement,
    this,
  )

  private readonly guestContainers = [
    new VideoContainer(
      document.getElementById('guest-one-meeting') as HTMLDivElement,
      document.getElementById('guest-one-vid') as HTMLVideoElement,
      this,
      document.getElementById('guest-one-meeting-peak') as HTMLDivElement,
    ),
    new VideoContainer(
      document.getElementById('guest-two-meeting') as HTMLDivElement,
      document.getElementById('guest-two-vid') as HTMLVideoElement,
      this,
      document.getElementById('guest-two-meeting-peak') as HTMLDivElement,
    ),
    new VideoContainer(
      document.getElementById('guest-three-meeting') as HTMLDivElement,
      document.getElementById('guest-three-vid') as HTMLVideoElement,
      this,
      document.getElementById('guest-three-meeting-peak') as HTMLDivElement,
    ),
  ]

  private firstContainer = this.selfVideoContainer

  constructor() {
    const micButton = document.getElementById('meeting-mic-button')!
    this.micButtonController = new MediaStreamButtonController(micButton, 'audio', false)
    const vidButton = document.getElementById('meeting-camera-button')!
    this.videoButtonController = new MediaStreamButtonController(vidButton, 'video', false)
    this.setUiForDisconnectedState()
    this.applyVideoLayout()
    this.selfVideoContainer.isActive = true
    this.guestContainers.forEach(c => c.isActive = false)

    LocalMediaStreams.registerAVDeviceListener((added, track) => {
      if (track.kind == 'video') {
        if (added) {
          this.selfVideoContainer.vidElement.srcObject = LocalMediaStreams.localAVDeviceMediaStream
        } else {
          this.selfVideoContainer.vidElement.srcObject = null
        }
      } else {
        if (added) {
          this.selfVideoContainer.startPeakMeter(AudioInputs.localAVDevice!)
        } else {
          this.selfVideoContainer.stopPeakMeter()
        }
      }
    })
    this.selfVideoContainer.vidElement.style.transform = 'scale(-1,1)'
    this.selfVideoContainer.vidElement.muted = true
    this.selfVideoContainer.vidElement.poster = this.getSvgPosterForUser('You', true)
    this.selfVideoContainer.vidElement.onloadedmetadata = () => {
      this.selfVideoContainer.vidElement.play()
    }
    document.addEventListener('click', (event) => {
      const layoutSelector = document.getElementById('meeting-layout-selector')
      if (!layoutSelector?.contains(event.target as Node)) {
        this.closeLayoutMenu()
      }
    })
    this.updateLayoutSelectionUi()
  }

  async createMeeting(): Promise<boolean> {
    if (this.remoteMediaClient) {
      this.createMeetingErrorBubble.showError('You are already connected.')
      return false
    }
    const username = this.usernameForm.value
    if (!username || (username as string).trim().length == 0) {
      this.usernameErrorBubble.showError('Please enter your name', 2000)
      return false
    }
    this.remoteMediaClient = new RemoteMediaClient2(username)
    this.remoteMediaClient.addStateListener(state => this.stateListener(this, state))
    this.setUiForConnectedState()
    return true
  }

  async joinMeeting(): Promise<boolean> {
    if (this.remoteMediaClient) {
      return false
    }

    if (window.location.search) {
      const meetingId = new URL(window.location.toString()).searchParams.get('meeting')
      if (!meetingId) {
        return false
      }
      const username = this.usernameForm.value
      if (!username || (username as string).trim().length == 0) {
        this.usernameErrorBubble.showError('Please enter your name', 2000)
        return false
      }

      this.logger.log('About to join ' + meetingId)
      this.remoteMediaClient = new RemoteMediaClient2(username, meetingId)
      this.remoteMediaClient.addStateListener(state => this.stateListener(this, state))
      this.setUiForConnectedState()
    }
    return false
  }

  async amInRoom() {
    return this.remoteMediaClient?.amInRoom() ?? false
  }

  toggleLayoutMenu() {
    const layoutMenu = document.getElementById('meeting-layout-menu')!
    layoutMenu.classList.toggle('open')
    const layoutButton = document.getElementById('switch-meeting-layout-button')!
    layoutButton.setAttribute('aria-expanded', layoutMenu.classList.contains('open') ? 'true' : 'false')
  }

  closeLayoutMenu() {
    document.getElementById('meeting-layout-menu')!.classList.remove('open')
    document.getElementById('switch-meeting-layout-button')!.setAttribute('aria-expanded', 'false')
  }

  selectVideoLayout(layout: VideoLayout) {
    this.videoLayout = layout
    this.closeLayoutMenu()
    this.applyVideoLayout()
  }

  applyVideoLayout() {
    switch (this.videoLayout) {
      case 'spotlight':
        this.firstContainer.divElement.classList = 'vid-div meeting-spotlit'
        const containers = [...this.containers().filter(c => c.isActive)]
        let i = 0
        for (const container of containers) {
          if (container != this.firstContainer) {
            container.divElement.classList = 'vid-div meeting-unspotlit'
            container.divElement.style.top = '70%'
            container.divElement.style.left = `${(5 - containers.length) * 12.5 + i * 25}%`
            ++i
          } else {
            container.divElement.style.top = ''
            container.divElement.style.left = ''
          }
        }
        break
      case 'solo':
        for (const container of this.containers()) {
          container.divElement.style.top = ''
          container.divElement.style.left = ''
          if (container == this.firstContainer) {
            container.divElement.classList = 'vid-div meeting-solo'
          } else {
            container.divElement.classList = 'vid-div meeting-hidden'
          }
        }
        break
      case 'grid':
        const guestCount = this.currentState.members.length
        switch(guestCount) {
          case 0:
            this.selfVideoContainer.divElement.classList = 'vid-div meeting-solo'
            this.selfVideoContainer.divElement.style.top = ''
            this.selfVideoContainer.divElement.style.left = ''
            break
          case 1:
            for (const container of this.containers()) {
              container.divElement.classList = 'vid-div meeting-grid-half'
              container.divElement.style.left = ''
              if (container != this.firstContainer) {
                container.divElement.style.top = '50%'
              } else {
                container.divElement.style.top = ''
              }
            }
            break
          case 2:
          case 3:
            let i = 1
            for (const container of this.containers()) {
              container.divElement.classList = 'vid-div meeting-grid-quarter'
              if (container != this.firstContainer) {
                container.divElement.style.top = `${Math.floor(i / 2) * 50}%`
                container.divElement.style.left = `${(i % 2) * 50}%`
              } else {
                container.divElement.style.top = ''
                container.divElement.style.left = ''
              }
              ++i
            }
            break
        }
        break
    }
    this.firstContainer.divElement.classList.add('first-meeting-container')
    this.updateLayoutSelectionUi()
  }

  spotlightElement(videoContainer: VideoContainer) {
    const oldClassList = videoContainer.divElement.classList.toString()
    videoContainer.divElement.classList = this.firstContainer.divElement.classList.toString()
    this.firstContainer.divElement.classList = oldClassList
    this.firstContainer.divElement.style.top = videoContainer.divElement.style.top
    this.firstContainer.divElement.style.left = videoContainer.divElement.style.left
    videoContainer.divElement.style.top = ''
    videoContainer.divElement.style.left = ''
    this.firstContainer = videoContainer
  }

  disconnect() {
    this.remoteMediaClient?.disconnect()
    this.remoteMediaClient = null
    this.setUiForDisconnectedState()
  }

  private *containers() {
    yield this.selfVideoContainer
    yield this.screenVideoContainer
    for (const c of this.guestContainers) {
      yield c
    }
  }

  private async stateListener(meetingRoomController: MeetingRoomController, state: State) {
    console.error(`new state ${JSON.stringify(state)}`)
    if (this.currentState == state) {
      return
    }
    if (state.error) {
      this.notificationsController.showError(state.error)
      this.setUiForDisconnectedState()
      return
    }
    
    if (state.screenShare) {
      if (state.screenShare == 'self') {
        this.screenVideoContainer.vidElement.srcObject = LocalMediaStreams.localScreenMediaStream
      } else {
        this.screenVideoContainer.vidElement.srcObject = state.screenShare.mediaStream
      }
      if (!this.screenVideoContainer.isActive) {
        meetingRoomController.videoLayout = VideoLayout.SPOTLIGHT
        this.spotlightElement(this.screenVideoContainer)
      }
      this.screenVideoContainer.isActive = true
    } else {
      this.screenVideoContainer.vidElement.srcObject = null
      this.screenVideoContainer.isActive = false
    }
    for (let i = 0; i < this.guestContainers.length; ++i) {
      if (state.members.length > i) {
        this.guestContainers[i].vidElement.srcObject = state.members[i].mediaStream
        this.guestContainers[i].startPeakMeter(AudioInputs.remoteStreams.get(
          { username: state.members[i].username, isScreenShare: false}
        )!)
        this.guestContainers[i].isActive = true
      } else {
        this.guestContainers[i].vidElement.srcObject = null
        this.guestContainers[i].stopPeakMeter()
        this.guestContainers[i].isActive = false
      }
    }
    meetingRoomController.applyVideoLayout()
    this.currentState = { ...state }
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
    this.videoLayout = VideoLayout.SOLO
    this.closeLayoutMenu()
    this.spotlightElement(this.selfVideoContainer)
    this.applyVideoLayout()
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
    this.videoLayout = VideoLayout.GRID
    this.closeLayoutMenu()
    this.applyVideoLayout()
  }

  private updateLayoutSelectionUi() {
    for (const layout of Object.values(VideoLayout)) {
      const selected = layout == this.videoLayout
      document.getElementById(`meeting-layout-check-${layout}`)!.classList.toggle('selected', selected)
      document.getElementById(`meeting-layout-option-${layout}`)!.setAttribute('aria-checked', selected ? 'true' : 'false')
    }
  }

  private getSvgPosterForUser(username: string, isSelf: boolean) {
    const svgString = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><style>svg { background-color:rgb(50, 50, 50); fill: white;}</style><text x="${isSelf ? '-' : ''}50" y="50" font-family="Georgia, Palantino, serif" dominant-baseline="middle" text-anchor="middle" ${isSelf ? 'transform="scale(-1, 1)"' : ''}>${username}</text></svg>`
    return 'data:image/svg+xml,' + encodeURIComponent(svgString)
  }
}
