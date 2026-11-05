import { AudioInputs } from '../audioinputs/AudioInputs'
import type { MediaStreamInput } from '../audioinputs/MediaStreamInput'
import { LocalMediaStreams } from '../mediastreams/LocalMediaStreams'
import { VideoInputs } from '../videoinputs/VideoInputs'
import { BottomPanelController } from './BottomPanelController'
import { PeakMeterController } from './PeakMeterController'
import { createSvgIcon } from './SvgIcon'

type LocalInput = {
  readonly name: string
  readonly icon: string
  /** Also the id of the matching video input. */
  readonly audioInput: MediaStreamInput
  readonly stream: MediaStream
  readonly mirrored: boolean
  readonly noVideoText: string
  readonly noAudioText: string
}

/** The top panel's Inputs tab: the level and live picture of this machine's microphone, camera and screen capture. */
export class InputsPanelController {
  private readonly shell = BottomPanelController.getInstance()
  private readonly content = document.createElement('section')
  private readonly list = document.createElement('div')
  private readonly emptyMessage = document.createElement('p')
  private meters = new Array<PeakMeterController>()
  /** Kept per track so re-rendering does not restart a picture that is still live. */
  private videos = new Map<string, HTMLVideoElement>()

  constructor() {
    this.content.className = 'inputs-panel-content'
    this.list.className = 'inputs-panel-list'
    this.emptyMessage.className = 'bottom-panel-message'
    this.emptyMessage.textContent =
      'No inputs are on. Enable the microphone, camera, or screen capture with the buttons at the top.'
    this.content.append(this.list, this.emptyMessage)
    this.shell.open({ tab: 'inputs', owner: this, body: this.content })
    this.shell.addVisibilityListener('inputs', (visible) => (visible ? this.render() : this.clear()))
    const refresh = () => {
      if (this.shell.isVisible('inputs')) this.render()
    }
    AudioInputs.addListener(refresh)
    VideoInputs.addListener(refresh)
  }

  private localInputs(): LocalInput[] {
    return [
      {
        name: 'Microphone and camera',
        icon: 'microphone',
        audioInput: AudioInputs.localAVDevice,
        stream: LocalMediaStreams.localAVDeviceMediaStream,
        mirrored: true,
        noVideoText: 'Camera off',
        noAudioText: 'Microphone off',
      },
      {
        name: 'Screen capture',
        icon: 'browser-tab',
        audioInput: AudioInputs.localScreenShare,
        stream: LocalMediaStreams.localScreenMediaStream,
        mirrored: false,
        noVideoText: 'No picture',
        noAudioText: 'No shared audio',
      },
    ]
  }

  private render(): void {
    for (const meter of this.meters) meter.stop()
    this.meters = []
    const videoTracks = new Map(
      VideoInputs.gather()
        .filter((input) => !input.remote)
        .map((input) => [input.id, input.track]),
    )
    const videos = new Map<string, HTMLVideoElement>()
    const cards = new Array<HTMLElement>()
    for (const input of this.localInputs()) {
      const hasAudio = input.stream.getAudioTracks().length > 0
      const videoTrack = videoTracks.get(input.audioInput.id) ?? null
      if (hasAudio || videoTrack) cards.push(this.createCard(input, hasAudio, videoTrack, videos))
    }
    for (const [trackId, video] of this.videos) {
      if (!videos.has(trackId)) video.srcObject = null
    }
    this.videos = videos
    this.list.replaceChildren(...cards)
    this.list.hidden = cards.length === 0
    this.emptyMessage.hidden = cards.length > 0
  }

  private createCard(
    input: LocalInput,
    hasAudio: boolean,
    videoTrack: MediaStreamTrack | null,
    videos: Map<string, HTMLVideoElement>,
  ): HTMLElement {
    const card = document.createElement('article')
    card.className = 'input-card'
    const header = document.createElement('header')
    header.className = 'input-card-header'
    const title = document.createElement('h3')
    title.id = `input-card-${input.audioInput.id}`
    title.textContent = input.name
    card.setAttribute('aria-labelledby', title.id)
    // A missing picture is shown in the picture's place; missing audio has no meter to stand in for it.
    const note = document.createElement('span')
    note.className = 'input-card-note'
    note.textContent = hasAudio ? '' : input.noAudioText
    header.append(createSvgIcon(input.icon, { className: 'input-card-icon' }), title, note)

    const body = document.createElement('div')
    body.className = 'input-card-body'
    const picture = document.createElement('div')
    picture.className = 'input-card-video'
    if (videoTrack) {
      picture.classList.toggle('mirrored', input.mirrored)
      const video = this.videos.get(videoTrack.id) ?? this.createVideo(input, videoTrack)
      videos.set(videoTrack.id, video)
      picture.appendChild(video)
    } else {
      const off = document.createElement('p')
      off.textContent = input.noVideoText
      picture.appendChild(off)
    }
    body.appendChild(picture)
    if (hasAudio) {
      const meterElement = document.createElement('div')
      meterElement.className = 'input-card-meter'
      const meter = new PeakMeterController(meterElement, input.audioInput, false, input.audioInput.channelCount)
      // The meter spans the card's full height instead of keeping its narrow default shape.
      meter.svg.setAttribute('preserveAspectRatio', 'none')
      meter.setLabel(`${input.name} level`)
      meter.draw(meter)
      this.meters.push(meter)
      body.appendChild(meterElement)
    }
    card.append(header, body)
    return card
  }

  private createVideo(input: LocalInput, track: MediaStreamTrack): HTMLVideoElement {
    const video = document.createElement('video')
    video.muted = true
    video.autoplay = true
    video.playsInline = true
    video.setAttribute('aria-label', `${input.name} picture`)
    video.srcObject = new MediaStream([track])
    return video
  }

  private clear(): void {
    for (const meter of this.meters) meter.stop()
    this.meters = []
    for (const video of this.videos.values()) video.srcObject = null
    this.videos.clear()
    this.list.replaceChildren()
  }
}
