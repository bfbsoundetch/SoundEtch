import { RemoteMediaClient3, type JoinRequest, type RecordingActivity, type State } from '../remote/RemoteMediaClient3'
import { MediaStreamButtonController } from './MediaStreamButtonController'
import { SpeakerMeterController } from './SpeakerMeterController'
import { Direction, ErrorBubbleController } from './ErrorBubbleController'
import { NotificationsController } from './NotificationsController'
import { AudioInputs } from '../audioinputs/AudioInputs'
import { VideoInputs } from '../videoinputs/VideoInputs'
import { AudioInput } from '../audioinputs/AudioInput'
import { LocalMediaStreams } from '../mediastreams/LocalMediaStreams'
import { Logger } from '../global/Logger'
import { AudioControl, AudioState } from '../audiocontext/AudioControl'
import { RecordButtonController } from './RecordButtonController'
import { announce } from './LiveAnnouncer'
import { HighQualityMediaSender } from '../remote/HighQualityMediaSender'
import { HighQualityMediaReceiver } from '../remote/HighQualityMediaReceiver'

enum VideoLayout {
  SPOTLIGHT = 'spotlight',
  SOLO = 'solo',
  GRID = 'grid',
}

const DISCONNECTED_STATE: State = {
  members: [],
  roomId: null,
  isHost: false,
  hostUsername: null,
  waitingForHost: false,
  joinRequests: [],
  screenShare: null,
  error: null,
}

class VideoContainer {
  private speakerMeter: SpeakerMeterController | null = null
  private readonly recordingActivityElement = document.createElement('div')
  private recordingActivityToken = 0
  private recordingActivityTimeout: number | null = null
  private recordingActivityKey: string | null = null
  private recordingState: RecordingActivity['state'] = 'idle'
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
    this.divElement.tabIndex = 0
    this.divElement.setAttribute('role', 'button')
    this.divElement.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        meetingRoomController.spotlightElement(this)
      }
    })
    this.recordingActivityElement.className = 'meeting-recording-activity'
    this.recordingActivityElement.style.display = 'none'
    this.divElement.appendChild(this.recordingActivityElement)
  }

  setName(name: string | null) {
    if (name) {
      this.divElement.setAttribute('aria-label', `Spotlight ${name}`)
    } else {
      this.divElement.removeAttribute('aria-label')
    }
  }

  startSpeakerMeter(audioInput: AudioInput) {
    if (!this.audioElement) {
      return null
    }
    if (!this.speakerMeter) {
      this.speakerMeter = new SpeakerMeterController(this.audioElement, audioInput)
    }
    this.speakerMeter!.draw(this.speakerMeter!)
    this.audioElement!.style.display = 'inline-block'
  }

  stopSpeakerMeter() {
    if (!this.speakerMeter) {
      return
    }
    this.speakerMeter.remove()
    this.speakerMeter.stop()
    this.speakerMeter = null
    this.audioElement!.style.display = 'none'
  }

  setRecordingActivity(username: string, recordingActivity: RecordingActivity) {
    const recordingActivityKey = this.getRecordingActivityKey(username, recordingActivity)
    if (this.recordingActivityKey == recordingActivityKey) {
      return
    }

    this.recordingActivityKey = recordingActivityKey
    const previousState = this.recordingState
    this.recordingState = recordingActivity.state
    switch (recordingActivity.state) {
      case 'countdown':
        announce(`${username} starts recording in ${Math.ceil(recordingActivity.durationMs / 1000)} seconds`)
        break
      case 'recording':
        announce(`${username} is recording`)
        break
      case 'paused':
        announce(`${username} paused recording`)
        break
      case 'idle':
        if (previousState !== 'idle') announce(`${username} stopped recording`)
        break
    }
    this.clearRecordingActivityTimeout()
    const recordingActivityToken = ++this.recordingActivityToken

    switch (recordingActivity.state) {
      case 'idle':
        this.hideRecordingActivity()
        break
      case 'countdown':
        this.drawRecordingCountdown(username, performance.now() + recordingActivity.durationMs, recordingActivityToken)
        break
      case 'recording':
        this.showRecordingActivity(`${username} is recording`)
        break
      case 'paused':
        this.showRecordingActivity(`${username} paused recording`)
        break
    }
  }

  clearRecordingActivity() {
    this.recordingActivityKey = null
    this.recordingState = 'idle'
    this.clearRecordingActivityTimeout()
    ++this.recordingActivityToken
    this.hideRecordingActivity()
  }

  private drawRecordingCountdown(username: string, countdownEndsAtMs: number, recordingActivityToken: number) {
    if (recordingActivityToken != this.recordingActivityToken) {
      return
    }

    const remainingMs = countdownEndsAtMs - performance.now()
    if (remainingMs <= 0) {
      this.showRecordingActivity(`${username} is recording`)
      return
    }

    const remainingSeconds = Math.ceil(remainingMs / 1000)
    this.showRecordingActivity(`${username} is recording in ${remainingSeconds}`)
    this.recordingActivityTimeout = window.setTimeout(
      () => this.drawRecordingCountdown(username, countdownEndsAtMs, recordingActivityToken),
      Math.max(1, remainingMs - (remainingSeconds - 1) * 1000),
    )
  }

  private showRecordingActivity(message: string) {
    this.recordingActivityElement.innerText = message
    this.recordingActivityElement.style.display = 'block'
  }

  private hideRecordingActivity() {
    this.recordingActivityElement.innerText = ''
    this.recordingActivityElement.style.display = 'none'
  }

  private clearRecordingActivityTimeout() {
    if (this.recordingActivityTimeout == null) {
      return
    }
    window.clearTimeout(this.recordingActivityTimeout)
    this.recordingActivityTimeout = null
  }

  private getRecordingActivityKey(username: string, recordingActivity: RecordingActivity) {
    return `${username}:${recordingActivity.state}:${recordingActivity.countdownId ?? ''}:${
      recordingActivity.state == 'countdown' ? recordingActivity.durationMs : ''
    }`
  }
}

export class MeetingRoomController {
  private videoLayout = VideoLayout.GRID
  private usernameForm = document.getElementById('username-form') as HTMLInputElement
  private enterMeetingButton = document.getElementById('enter-meeting-room-button') as HTMLButtonElement
  private meetingRecordButton = document.getElementById('meeting-record-button') as HTMLButtonElement
  private localRecordingActivity: RecordingActivity = { state: 'idle', countdownId: null }
  private readonly recordButtonController = new RecordButtonController(
    this.meetingRecordButton,
    'meeting-button',
    (recordingActivity) => this.setLocalRecordingActivity(recordingActivity),
  )

  private currentState: State = DISCONNECTED_STATE
  private renderedJoinRequestsKey = ''
  private remoteMediaClient: RemoteMediaClient3 | null = null
  /** Sends this member's high-quality media to whoever records it. */
  private highQualityMediaSender: HighQualityMediaSender | null = null
  /** Upgrades this recorder's recordings of the other members with their high-quality media. */
  private highQualityMediaReceiver: HighQualityMediaReceiver | null = null

  private readonly usernameErrorBubble = new ErrorBubbleController(
    'MeetingUsername',
    this.usernameForm.parentElement as HTMLDivElement,
  )
  private readonly enterMeetingErrorBubble = new ErrorBubbleController(
    'EnterMeetingButton',
    this.enterMeetingButton.parentElement as HTMLElement,
  )
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
    AudioControl.addAudioControlListener((state) => this.updateMeetingRecordButton(state))
    this.setUiForDisconnectedState()
    this.applyVideoLayout()
    this.selfVideoContainer.isActive = true
    this.guestContainers.forEach((c) => (c.isActive = false))
    this.updateContainerInertness()

    LocalMediaStreams.registerAVDeviceListener((added, track) => {
      if (track.kind == 'video') {
        if (added) {
          this.selfVideoContainer.vidElement.srcObject = LocalMediaStreams.localAVDeviceMediaStream
        } else {
          this.selfVideoContainer.vidElement.srcObject = null
        }
      } else {
        if (added) {
          this.selfVideoContainer.startSpeakerMeter(AudioInputs.localAVDevice!)
        } else {
          this.selfVideoContainer.stopSpeakerMeter()
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
      const linkSelector = document.getElementById('meeting-link-selector')
      if (!layoutSelector?.contains(event.target as Node)) {
        this.closeLayoutMenu()
      }
      if (!linkSelector?.contains(event.target as Node)) {
        this.closeLinkMenu()
      }
    })
    this.updateLayoutSelectionUi()
    this.selfVideoContainer.setName('your video')
    this.screenVideoContainer.setName('screen share')
    this.usernameForm.addEventListener('input', () => {
      this.usernameForm.removeAttribute('aria-invalid')
      this.usernameForm.setAttribute('aria-describedby', 'username-form-hint')
      this.usernameErrorBubble.hide()
    })

    const layoutMenu = document.getElementById('meeting-layout-menu')!
    const settingsButton = document.getElementById('meeting-settings-button')!
    const options = Array.from(layoutMenu.querySelectorAll<HTMLButtonElement>('.meeting-layout-option'))
    layoutMenu.addEventListener('keydown', (event) => {
      const current = options.indexOf(document.activeElement as HTMLButtonElement)
      let next: number | null = null
      switch (event.key) {
        case 'ArrowDown':
          next = (current + 1) % options.length
          break
        case 'ArrowUp':
          next = (current - 1 + options.length) % options.length
          break
        case 'Home':
          next = 0
          break
        case 'End':
          next = options.length - 1
          break
        case 'Escape':
          event.preventDefault()
          this.closeLayoutMenu()
          settingsButton.focus()
          return
      }
      if (next !== null) {
        event.preventDefault()
        options[next]?.focus()
      }
    })
    settingsButton.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      event.preventDefault()
      if (!layoutMenu.classList.contains('open')) this.toggleLayoutMenu()
      options[event.key === 'ArrowDown' ? 0 : options.length - 1]?.focus()
    })
    document.getElementById('meeting-link-menu')!.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      this.closeLinkMenu()
      document.getElementById('open-meeting-link-button')!.focus()
    })
    const layoutSelector = document.getElementById('meeting-layout-selector')!
    layoutSelector.addEventListener('focusout', (event) => {
      if (!layoutSelector.contains(event.relatedTarget as Node | null)) this.closeLayoutMenu()
    })
    const linkSelector = document.getElementById('meeting-link-selector')!
    linkSelector.addEventListener('focusout', (event) => {
      if (!linkSelector.contains(event.relatedTarget as Node | null)) this.closeLinkMenu()
    })
    // Closing the tab tears down connections without telling anyone, so the others would only notice once ICE times
    // out. Leaving explicitly removes us from their meeting right away.
    window.addEventListener('pagehide', () => this.disconnectNow())
  }

  async createMeeting(): Promise<boolean> {
    if (this.remoteMediaClient) {
      this.enterMeetingErrorBubble.showError('You are already connected.')
      return false
    }
    const username = this.usernameForm.value
    if (!username || (username as string).trim().length == 0) {
      this.showUsernameRequired()
      return false
    }
    this.remoteMediaClient = new RemoteMediaClient3(username)
    AudioInputs.registerRemoteMediaClient(this.remoteMediaClient)
    VideoInputs.registerRemoteMediaClient(this.remoteMediaClient)
    this.startHighQualityMedia(this.remoteMediaClient)
    this.remoteMediaClient.setRecordingActivity(this.localRecordingActivity)
    this.remoteMediaClient.addStateListener((state) => this.stateListener(state))
    this.remoteMediaClient.addMessageListener((message) =>
      NotificationsController.showLongDurationMessage(message.info),
    )
    this.setUiForConnectedState()
    return true
  }

  async joinMeeting(): Promise<boolean> {
    if (this.remoteMediaClient) {
      this.enterMeetingErrorBubble.showError('You are already connected.')
      return false
    }

    if (window.location.search) {
      const meetingId = new URL(window.location.toString()).searchParams.get('meeting')
      if (!meetingId) {
        return false
      }
      const username = this.usernameForm.value
      if (!username || (username as string).trim().length == 0) {
        this.showUsernameRequired()
        return false
      }

      this.logger.log('About to join ' + meetingId)
      this.remoteMediaClient = new RemoteMediaClient3(username, meetingId)
      AudioInputs.registerRemoteMediaClient(this.remoteMediaClient)
      VideoInputs.registerRemoteMediaClient(this.remoteMediaClient)
      this.startHighQualityMedia(this.remoteMediaClient)
      this.remoteMediaClient.setRecordingActivity(this.localRecordingActivity)
      this.remoteMediaClient.addStateListener((state) => this.stateListener(state))
      this.remoteMediaClient.addMessageListener((message) =>
        NotificationsController.showLongDurationMessage(message.info),
      )
      this.setUiForConnectedState()
      return true
    }
    return false
  }

  private showUsernameRequired() {
    this.usernameForm.setAttribute('aria-invalid', 'true')
    this.usernameForm.setAttribute('aria-describedby', 'username-form-hint error-bubble-MeetingUsername')
    this.usernameErrorBubble.showError('Please enter your name')
    this.usernameForm.focus()
  }

  async amInRoom() {
    return this.remoteMediaClient?.amInRoom() ?? false
  }

  toggleLayoutMenu() {
    const layoutMenu = document.getElementById('meeting-layout-menu')!
    const shouldOpen = !layoutMenu.classList.contains('open')
    this.closeLinkMenu()
    layoutMenu.classList.toggle('open', shouldOpen)
    const layoutButton = document.getElementById('meeting-settings-button')!
    layoutButton.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false')
    if (shouldOpen) {
      layoutMenu.querySelector<HTMLElement>('[aria-checked="true"]')?.focus()
    }
  }

  closeLayoutMenu() {
    document.getElementById('meeting-layout-menu')!.classList.remove('open')
    document.getElementById('meeting-settings-button')!.setAttribute('aria-expanded', 'false')
  }

  toggleLinkMenu() {
    const linkMenu = document.getElementById('meeting-link-menu')!
    const shouldOpen = !linkMenu.classList.contains('open')
    this.closeLayoutMenu()
    linkMenu.classList.toggle('open', shouldOpen)
    document.getElementById('open-meeting-link-button')!.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false')
  }

  closeLinkMenu() {
    document.getElementById('meeting-link-menu')!.classList.remove('open')
    document.getElementById('open-meeting-link-button')!.setAttribute('aria-expanded', 'false')
  }

  selectVideoLayout(layout: VideoLayout) {
    this.videoLayout = layout
    this.closeLayoutMenu()
    document.getElementById('meeting-settings-button')!.focus()
    this.applyVideoLayout()
  }

  async copyMeetingLink() {
    const meetingLink = this.getMeetingLink()
    if (!meetingLink) {
      NotificationsController.showErrorMessage('Meeting link is not available yet.')
      return
    }
    try {
      await navigator.clipboard.writeText(meetingLink)
      NotificationsController.showShortDurationMessage('Meeting link copied.')
    } catch (_) {
      NotificationsController.showErrorMessage('Unable to copy the meeting link.')
    }
  }

  applyVideoLayout() {
    switch (this.videoLayout) {
      case 'spotlight':
        this.firstContainer.divElement.classList = 'vid-div meeting-spotlit'
        const containers = [...this.containers().filter((c) => c.isActive)]
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
        switch (guestCount) {
          case 0:
            this.selfVideoContainer.divElement.classList = 'vid-div meeting-solo'
            this.selfVideoContainer.divElement.style.top = ''
            this.selfVideoContainer.divElement.style.left = ''
            for (const container of this.guestContainers) {
              container.divElement.classList = 'vid-div meeting-hidden'
            }
            break
          case 1:
            for (const container of [this.selfVideoContainer, this.guestContainers[0]]) {
              container.divElement.classList = 'vid-div meeting-grid-half'
              container.divElement.style.top = ''
              if (container != this.firstContainer) {
                container.divElement.style.left = '50%'
              } else {
                container.divElement.style.left = ''
              }
            }
            this.guestContainers[1].divElement.classList = 'vid-div meeting-hidden'
            this.guestContainers[2].divElement.classList = 'vid-div meeting-hidden'
            break
          case 2: {
            let i = 1
            for (const container of [this.selfVideoContainer, this.guestContainers[0], this.guestContainers[1]]) {
              container.divElement.classList = 'vid-div meeting-grid-third'
              container.divElement.style.top = ''
              if (container != this.firstContainer) {
                container.divElement.style.left = `${i * 33}%`
                ++i
              } else {
                container.divElement.style.left = ''
              }
            }
            this.guestContainers[2].divElement.classList = 'vid-div meeting-hidden'
            break
          }
          case 3: {
            let i = 1
            for (const container of [this.selfVideoContainer, ...this.guestContainers]) {
              container.divElement.classList = 'vid-div meeting-grid-quarter'
              if (container != this.firstContainer) {
                container.divElement.style.top = `${Math.floor(i / 2) * 50}%`
                container.divElement.style.left = `${(i % 2) * 50}%`
                ++i
              } else {
                container.divElement.style.top = ''
                container.divElement.style.left = ''
              }
            }
            break
          }
        }
        break
    }
    this.firstContainer.divElement.classList.add('first-meeting-container')
    this.updateLayoutSelectionUi()
    this.updateContainerInertness()
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
    this.updateContainerInertness()
  }

  private updateContainerInertness() {
    for (const c of this.containers()) {
      c.divElement.inert = !c.isActive || c.divElement.classList.contains('meeting-hidden')
    }
  }

  /** Leaves the meeting once a cloud upload in progress has the links it needs to finish without the meeting. */
  async disconnect() {
    const client = this.remoteMediaClient
    try {
      await this.highQualityMediaSender?.prepareToLeave()
    } catch (error) {
      this.logger.error(error instanceof Error ? error : new Error(String(error)))
    }
    if (this.remoteMediaClient === client) {
      this.disconnectNow()
    }
  }

  private disconnectNow() {
    this.disposeHighQualityMedia()
    this.remoteMediaClient?.disconnect()
    this.remoteMediaClient = null
    this.setUiForDisconnectedState()
  }

  private startHighQualityMedia(client: RemoteMediaClient3) {
    this.highQualityMediaSender = new HighQualityMediaSender(client)
    this.highQualityMediaReceiver = new HighQualityMediaReceiver(client)
  }

  private disposeHighQualityMedia() {
    this.highQualityMediaSender?.dispose()
    this.highQualityMediaReceiver?.dispose()
    this.highQualityMediaSender = null
    this.highQualityMediaReceiver = null
  }

  private *containers() {
    yield this.selfVideoContainer
    yield this.screenVideoContainer
    for (const c of this.guestContainers) {
      yield c
    }
  }

  private async stateListener(state: State) {
    console.error(`new state ${JSON.stringify(state)}`)
    if (state.error) {
      if (!this.remoteMediaClient) {
        return
      }

      NotificationsController.showErrorMessage(state.error)
      this.disposeHighQualityMedia()
      this.remoteMediaClient = null
      this.setUiForDisconnectedState()
      return
    }

    if (state.screenShare) {
      if (state.screenShare == 'self') {
        this.screenVideoContainer.vidElement.srcObject = LocalMediaStreams.localScreenMediaStream
        this.screenVideoContainer.vidElement.muted = true
      } else {
        this.screenVideoContainer.vidElement.srcObject = state.screenShare.mediaStream
        this.screenVideoContainer.vidElement.muted = false
      }
      if (!this.screenVideoContainer.isActive) {
        this.videoLayout = VideoLayout.SPOTLIGHT
        this.spotlightElement(this.screenVideoContainer)
      }
      this.screenVideoContainer.isActive = true
    } else {
      this.screenVideoContainer.vidElement.srcObject = null
      this.screenVideoContainer.isActive = false
    }
    for (let i = 0; i < this.guestContainers.length; ++i) {
      if (state.members.length > i) {
        const mediaStream = state.members[i].mediaStream
        if (this.guestContainers[i].vidElement.srcObject != mediaStream) {
          this.guestContainers[i].vidElement.srcObject = mediaStream
        }
        const videoTrack = mediaStream.getVideoTracks()[0]
        if (videoTrack) {
          if ((videoTrack.getSettings().aspectRatio ?? 0) < 1) {
            this.guestContainers[i].vidElement.style.objectFit = 'contain'
          } else {
            this.guestContainers[i].vidElement.style.objectFit = 'cover'
          }
        } else {
          this.guestContainers[i].vidElement.load()
        }
        this.guestContainers[i].vidElement.poster = this.getSvgPosterForUser(state.members[i].username, false)
        this.guestContainers[i].setName(state.members[i].username)
        this.guestContainers[i].setRecordingActivity(state.members[i].username, state.members[i].recordingActivity)
        const remoteAudioInput = AudioInputs.getRemoteStreamForUser(state.members[i].peerId, false)
        if (remoteAudioInput && remoteAudioInput.isActive) {
          this.guestContainers[i].startSpeakerMeter(remoteAudioInput)
        } else {
          this.guestContainers[i].stopSpeakerMeter()
        }
        this.guestContainers[i].isActive = true
      } else {
        this.guestContainers[i].vidElement.srcObject = null
        this.guestContainers[i].vidElement.poster = ''
        this.guestContainers[i].setName(null)
        this.guestContainers[i].stopSpeakerMeter()
        this.guestContainers[i].clearRecordingActivity()
        this.guestContainers[i].isActive = false
      }
    }

    if (!this.firstContainer.isActive) {
      this.firstContainer = this.screenVideoContainer.isActive ? this.screenVideoContainer : this.selfVideoContainer
    }

    const oldPeerIds = new Set(this.currentState.members.map((m) => m.peerId))
    const newPeerIds = new Set(state.members.map((m) => m.peerId))
    const messages = [
      ...state.members.filter((m) => !oldPeerIds.has(m.peerId)).map((m) => `${m.username} joined the meeting`),
      ...this.currentState.members
        .filter((m) => !newPeerIds.has(m.peerId))
        .map((m) => `${m.username} left the meeting`),
    ]
    if (messages.length > 0) announce(messages.join('. '))
    this.currentState = { ...state, members: [...state.members] }
    this.applyVideoLayout()
    this.updateMeetingLinkUi()
    this.updateAdmissionUi(state)
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
    document.getElementById('vids')!.style.width = '70vw'
    document.getElementById('vids')!.style.height = '70vh'
    this.videoLayout = VideoLayout.SOLO
    this.closeLayoutMenu()
    this.closeLinkMenu()
    this.firstContainer = this.selfVideoContainer
    this.selfVideoContainer.isActive = true
    this.screenVideoContainer.vidElement.srcObject = null
    this.screenVideoContainer.isActive = false
    for (const guestContainer of this.guestContainers) {
      guestContainer.vidElement.srcObject = null
      guestContainer.stopSpeakerMeter()
      guestContainer.clearRecordingActivity()
      guestContainer.isActive = false
    }
    this.applyVideoLayout()
    this.currentState = DISCONNECTED_STATE
    this.updateMeetingLinkUi()
    this.updateAdmissionUi(DISCONNECTED_STATE)

    const meetingParam = new URL(window.location.toString()).searchParams.get('meeting')
    if (meetingParam) {
      this.enterMeetingButton.onclick = () => this.joinMeeting()
      this.enterMeetingButton.innerText = 'Join Meeting'
    } else {
      this.enterMeetingButton.onclick = () => this.createMeeting()
      this.enterMeetingButton.innerText = 'Create Meeting'
    }
    if ((document.getElementById('meeting-room') as HTMLDialogElement).open) {
      announce('Disconnected from the meeting')
      this.usernameForm.focus()
    }
  }

  private setUiForConnectedState() {
    const meetingControlsDiv = document.getElementById('meeting-controls')
    document.getElementById('meeting-controls')!.style.display = 'flex'
    const meetingLinkElement = document.getElementById('meeting-link-selector')!
    const micButton = document.getElementById('meeting-mic-button')!
    micButton!.remove()
    meetingControlsDiv!.insertBefore(micButton, meetingLinkElement)
    const cameraButton = document.getElementById('meeting-camera-button')!
    cameraButton!.remove()
    meetingControlsDiv!.insertBefore(cameraButton, meetingLinkElement)
    document.getElementById('meeting-device-setup-controls')!.style.display = 'none'
    document.getElementById('meeting-room-setup')!.style.display = 'none'
    document.getElementById('vids')!.style.width = '100%'
    document.getElementById('vids')!.style.height = '100%'
    this.videoLayout = VideoLayout.GRID
    this.closeLayoutMenu()
    this.closeLinkMenu()
    this.applyVideoLayout()
    this.updateMeetingLinkUi()
    announce(
      this.currentState.waitingForHost
        ? 'Asked to join the meeting. Waiting for the host to let you in.'
        : 'Connected to the meeting',
    )
    document.getElementById('open-meeting-link-button')!.focus()
  }

  private updateLayoutSelectionUi() {
    for (const layout of Object.values(VideoLayout)) {
      const selected = layout == this.videoLayout
      document.getElementById(`meeting-layout-check-${layout}`)!.classList.toggle('selected', selected)
      document
        .getElementById(`meeting-layout-option-${layout}`)!
        .setAttribute('aria-checked', selected ? 'true' : 'false')
    }
  }

  private updateMeetingLinkUi() {
    const linkSelector = document.getElementById('meeting-link-selector') as HTMLDivElement
    const linkBox = document.getElementById('meeting-link-box') as HTMLDivElement
    const linkElement = document.getElementById('meeting-link') as HTMLButtonElement
    const meetingLink = this.getMeetingLink()
    linkElement.setAttribute(
      'aria-label',
      meetingLink ? `Copy meeting link ${meetingLink}` : 'Meeting link is not available yet',
    )
    linkElement.title = 'Copy meeting link'

    if (!this.remoteMediaClient) {
      linkSelector.style.display = 'none'
      linkBox.style.display = 'none'
      linkElement.innerText = ''
      linkElement.disabled = true
      this.closeLinkMenu()
      return
    }

    linkSelector.style.display = ''
    linkBox.style.display = 'flex'
    linkElement.disabled = !this.currentState.roomId || !meetingLink
    linkElement.innerText = meetingLink ?? 'Meeting link is not available yet.'
  }

  private updateAdmissionUi(state: State) {
    const waitingElement = document.getElementById('meeting-waiting-for-host') as HTMLDivElement
    waitingElement.hidden = !state.waitingForHost
    waitingElement.innerText = state.hostUsername
      ? `Waiting for host ${state.hostUsername} to let you in…`
      : 'Waiting for the host to let you in…'

    const joinRequestsKey = state.joinRequests.map((joinRequest) => joinRequest.peerId).join()
    if (joinRequestsKey == this.renderedJoinRequestsKey) {
      return
    }

    this.renderedJoinRequestsKey = joinRequestsKey
    const joinRequestsElement = document.getElementById('meeting-join-requests') as HTMLDivElement
    const hadFocus = joinRequestsElement.contains(document.activeElement)
    joinRequestsElement.replaceChildren(
      ...state.joinRequests.map((joinRequest) => this.createJoinRequestElement(joinRequest)),
    )
    joinRequestsElement.hidden = state.joinRequests.length == 0
    if (hadFocus) {
      ;(joinRequestsElement.querySelector('button') ?? document.getElementById('open-meeting-link-button'))?.focus()
    }
  }

  private createJoinRequestElement(joinRequest: JoinRequest) {
    const element = document.createElement('div')
    element.className = 'meeting-join-request'
    const label = document.createElement('span')
    label.innerText = `${joinRequest.username} wants to join`
    element.appendChild(label)

    for (const [text, respond] of [
      ['Admit', () => this.remoteMediaClient?.admit(joinRequest.peerId)],
      ['Deny', () => this.remoteMediaClient?.deny(joinRequest.peerId)],
    ] as const) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'bordered clickable'
      button.innerText = text
      button.setAttribute('aria-label', `${text} ${joinRequest.username}`)
      button.onclick = respond
      element.appendChild(button)
    }
    return element
  }

  private setLocalRecordingActivity(recordingActivity: RecordingActivity) {
    if (this.recordingActivitiesAreEqual(this.localRecordingActivity, recordingActivity)) {
      return
    }

    this.localRecordingActivity = recordingActivity
    this.remoteMediaClient?.setRecordingActivity(recordingActivity)
  }

  private setLocalRecordingActivityFromAudioState(state: AudioState) {
    const previous = this.localRecordingActivity
    switch (state) {
      case AudioState.RECORDING:
        this.setLocalRecordingActivity({
          state: 'recording',
          countdownId: previous.state == 'idle' ? null : previous.countdownId,
        })
        break
      case AudioState.RECORDING_PAUSED:
        // Every recording context is suspended before it starts, which reports a pause before the recording begins.
        if (previous.state == 'recording' || previous.state == 'paused') {
          this.setLocalRecordingActivity({ state: 'paused', countdownId: previous.countdownId })
        }
        break
      default:
        this.setLocalRecordingActivity({ state: 'idle', countdownId: null })
        break
    }
  }

  private recordingActivitiesAreEqual(left: RecordingActivity, right: RecordingActivity) {
    if (left.state != right.state || left.countdownId != right.countdownId) {
      return false
    }
    return left.state != 'countdown' || right.state != 'countdown' || left.durationMs == right.durationMs
  }

  private updateMeetingRecordButton(state: AudioState) {
    this.setLocalRecordingActivityFromAudioState(state)

    const playIcon = this.meetingRecordButton.getElementsByClassName('play')[0] as SVGUseElement
    const recordIcon = this.meetingRecordButton.getElementsByClassName('record')[0] as SVGUseElement
    const label = this.meetingRecordButton.getElementsByTagName('span')[0]

    switch (state) {
      case AudioState.PLAYING:
        this.recordButtonController.cancelCountdown()
        playIcon.style.opacity = '1'
        recordIcon.style.opacity = '0'
        label.innerText = 'Playing'
        this.meetingRecordButton.disabled = false
        this.meetingRecordButton.setAttribute('aria-disabled', 'true')
        this.meetingRecordButton.className = 'meeting-button tooltipped animated-brightness'
        this.meetingRecordButton.onclick = () => {}
        this.meetingRecordButton.style.background = ''
        break
      case AudioState.RECORDING:
        this.recordButtonController.cancelCountdown()
        playIcon.style.opacity = '0'
        recordIcon.style.opacity = '1'
        label.innerText = 'Recording'
        this.meetingRecordButton.disabled = false
        this.meetingRecordButton.setAttribute('aria-disabled', 'true')
        this.meetingRecordButton.className = 'meeting-button tooltipped animated-brightness'
        this.meetingRecordButton.onclick = () => {}
        this.meetingRecordButton.style.background = ''
        break
      case AudioState.PLAYING_PAUSED:
        this.recordButtonController.cancelCountdown()
        playIcon.style.opacity = '1'
        recordIcon.style.opacity = '0'
        label.innerText = 'Resume Playing'
        this.meetingRecordButton.disabled = false
        this.meetingRecordButton.setAttribute('aria-disabled', 'false')
        this.meetingRecordButton.className = 'meeting-button tooltipped clickable'
        this.meetingRecordButton.onclick = AudioControl.unpause
        this.meetingRecordButton.style.background = ''
        break
      case AudioState.RECORDING_PAUSED:
        this.recordButtonController.cancelCountdown()
        playIcon.style.opacity = '0'
        recordIcon.style.opacity = '1'
        label.innerText = 'Resume Recording'
        this.meetingRecordButton.disabled = false
        this.meetingRecordButton.setAttribute('aria-disabled', 'false')
        this.meetingRecordButton.className = 'meeting-button tooltipped clickable'
        this.meetingRecordButton.onclick = AudioControl.unpause
        this.meetingRecordButton.style.background = ''
        break
      case AudioState.MONITORING:
      case AudioState.MONITORING_PAUSED:
      case AudioState.STOPPED:
        playIcon.style.opacity = '0'
        recordIcon.style.opacity = '1'
        label.innerText = 'Record'
        this.recordButtonController.configureStoppedState()
        break
    }
  }

  private getMeetingLink() {
    if (!this.currentState.roomId) {
      return null
    }
    const url = new URL(window.location.href)
    url.searchParams.set('meeting', this.currentState.roomId)
    return url.toString()
  }

  private getSvgPosterForUser(username: string, isSelf: boolean) {
    const svgString = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><style>svg { background-color:rgb(50, 50, 50); fill: white;}</style><text x="${isSelf ? '-' : ''}50" y="50" font-family="Georgia, Palantino, serif" dominant-baseline="middle" text-anchor="middle" ${isSelf ? 'transform="scale(-1, 1)"' : ''}>${username}</text></svg>`
    return 'data:image/svg+xml,' + encodeURIComponent(svgString)
  }
}
