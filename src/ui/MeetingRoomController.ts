import { RemoteMediaClient3, type RecordingActivity, type State } from '../remote/RemoteMediaClient3'
import { MediaStreamButtonController } from './MediaStreamButtonController'
import { PeakMeterController } from './PeakMeterController'
import { Direction, ErrorBubbleController } from './ErrorBubbleController'
import { NotificationsController } from './NotificationsController'
import { AudioInputs } from '../audioinputs/AudioInputs'
import { AudioInput } from '../audioinputs/AudioInput'
import { LocalMediaStreams } from '../mediastreams/LocalMediaStreams'
import { Logger } from '../global/Logger'
import { AudioControl, AudioState } from '../audiocontext/AudioControl'
import { RecordButtonController } from './RecordButtonController'

enum VideoLayout {
  SPOTLIGHT = 'spotlight',
  SOLO = 'solo',
  GRID = 'grid',
}

class VideoContainer {
  private peakMeter: PeakMeterController | null = null
  private readonly recordingActivityElement = document.createElement('div')
  private recordingActivityToken = 0
  private recordingActivityTimeout: number | null = null
  private recordingActivityKey: string | null = null
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
    this.recordingActivityElement.className = 'meeting-recording-activity'
    this.recordingActivityElement.style.display = 'none'
    this.divElement.appendChild(this.recordingActivityElement)
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

  setRecordingActivity(username: string, recordingActivity: RecordingActivity) {
    const recordingActivityKey = this.getRecordingActivityKey(username, recordingActivity)
    if (this.recordingActivityKey == recordingActivityKey) {
      return
    }

    this.recordingActivityKey = recordingActivityKey
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
    }
  }

  clearRecordingActivity() {
    this.recordingActivityKey = null
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
  private usernameForm = document.getElementById('username-form') as HTMLFormElement
  private enterMeetingButton = document.getElementById('enter-meeting-room-button') as HTMLButtonElement
  private meetingRecordButton = document.getElementById('meeting-record-button') as HTMLButtonElement
  private localRecordingActivity: RecordingActivity = { state: 'idle', countdownId: null }
  private readonly recordButtonController = new RecordButtonController(
    this.meetingRecordButton,
    'meeting-button',
    (recordingActivity) => this.setLocalRecordingActivity(recordingActivity),
  )

  private currentState: State = { members: [], roomId: null, screenShare: null, error: null }
  private remoteMediaClient: RemoteMediaClient3 | null = null

  private readonly usernameErrorBubble = new ErrorBubbleController(
    'MeetingUsername',
    this.usernameForm.parentElement as HTMLDivElement,
  )
  private readonly enterMeetingErrorBubble = new ErrorBubbleController('EnterMeetingButton', this.enterMeetingButton)
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
      const linkSelector = document.getElementById('meeting-link-selector')
      if (!layoutSelector?.contains(event.target as Node)) {
        this.closeLayoutMenu()
      }
      if (!linkSelector?.contains(event.target as Node)) {
        this.closeLinkMenu()
      }
    })
    this.updateLayoutSelectionUi()
  }

  async createMeeting(): Promise<boolean> {
    if (this.remoteMediaClient) {
      this.enterMeetingErrorBubble.showError('You are already connected.')
      return false
    }
    const username = this.usernameForm.value
    if (!username || (username as string).trim().length == 0) {
      this.usernameErrorBubble.showError('Please enter your name', 2000)
      return false
    }
    this.remoteMediaClient = new RemoteMediaClient3(username)
    this.remoteMediaClient.setRecordingActivity(this.localRecordingActivity)
    this.remoteMediaClient.addStateListener((state) => this.stateListener(state))
    this.remoteMediaClient.addMessageListener((message) => NotificationsController.showLongDurationMessage(message.info))
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
        this.usernameErrorBubble.showError('Please enter your name', 2000)
        return false
      }

      this.logger.log('About to join ' + meetingId)
      this.remoteMediaClient = new RemoteMediaClient3(username, meetingId)
      this.remoteMediaClient.setRecordingActivity(this.localRecordingActivity)
      this.remoteMediaClient.addStateListener((state) => this.stateListener(state))
      this.setUiForConnectedState()
      return true
    }
    return false
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
            for (const container of [this.guestContainers[1], this.guestContainers[2]]) {
              container.divElement.classList = 'vid-div meeting-hidden'
            }
            break
          case 2:
          case 3:
            let i = 1
            for (const container of [this.selfVideoContainer, ...this.guestContainers]) {
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

  private async stateListener(state: State) {
    console.error(`new state ${JSON.stringify(state)}`)
    if (state.error) {
      NotificationsController.showErrorMessage(state.error)
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
        if (this.guestContainers[i].vidElement.srcObject != state.members[i].mediaStream) {
          this.guestContainers[i].vidElement.srcObject = state.members[i].mediaStream
        }
        this.guestContainers[i].vidElement.poster = this.getSvgPosterForUser(state.members[i].username, false)
        this.guestContainers[i].setRecordingActivity(state.members[i].username, state.members[i].recordingActivity)
        // this.guestContainers[i].startPeakMeter(
        //   AudioInputs.remoteStreams.get({ username: state.members[i].username, isScreenShare: false })!,
        // )
        this.guestContainers[i].isActive = true
      } else {
        this.guestContainers[i].vidElement.srcObject = null
        this.guestContainers[i].vidElement.poster = ''
        this.guestContainers[i].stopPeakMeter()
        this.guestContainers[i].clearRecordingActivity()
        this.guestContainers[i].isActive = false
      }
    }

    if (!this.firstContainer.isActive) {
      this.firstContainer = this.screenVideoContainer.isActive ? this.screenVideoContainer : this.selfVideoContainer
    }

    this.currentState = { ...state, members: [...state.members] }
    this.applyVideoLayout()
    this.updateMeetingLinkUi()
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
      guestContainer.stopPeakMeter()
      guestContainer.clearRecordingActivity()
      guestContainer.isActive = false
    }
    this.applyVideoLayout()
    this.currentState = { members: [], roomId: null, screenShare: null, error: null }
    this.updateMeetingLinkUi()

    const meetingParam = new URL(window.location.toString()).searchParams.get('meeting')
    if (meetingParam) {
      this.enterMeetingButton.onclick = () => this.joinMeeting()
      this.enterMeetingButton.innerText = 'Join Meeting'
    } else {
      this.enterMeetingButton.onclick = () => this.createMeeting()
      this.enterMeetingButton.innerText = 'Create Meeting'
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

  private setLocalRecordingActivity(recordingActivity: RecordingActivity) {
    if (this.recordingActivitiesAreEqual(this.localRecordingActivity, recordingActivity)) {
      return
    }

    this.localRecordingActivity = recordingActivity
    this.remoteMediaClient?.setRecordingActivity(recordingActivity)
  }

  private setLocalRecordingActivityFromAudioState(state: AudioState) {
    switch (state) {
      case AudioState.RECORDING:
      case AudioState.RECORDING_PAUSED:
        this.setLocalRecordingActivity({
          state: 'recording',
          countdownId:
            this.localRecordingActivity.state == 'countdown' || this.localRecordingActivity.state == 'recording'
              ? this.localRecordingActivity.countdownId
              : null,
        })
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
