import { AudioControl, AudioState, isRecordingState } from '../audiocontext/AudioControl'
import type { Project } from '../project/Project'
import type { Track } from '../project/Track'
import { resolveVideoFrame } from '../video/VideoFrameResolver'
import { VideoPreview } from '../video/VideoPreview'
import { BottomPanelController } from './BottomPanelController'
import { NotificationsController } from './NotificationsController'
import type { TrackListController } from './timeline/TrackListController'

export class VideoPanelController {
  private readonly shell = BottomPanelController.getInstance()
  private readonly content = document.createElement('section')
  private readonly trackLabel = document.createElement('label')
  private readonly trackSelect = document.createElement('select')
  private readonly stage = document.createElement('div')
  private readonly canvas = document.createElement('canvas')
  private readonly status = document.createElement('p')
  private readonly preview: VideoPreview
  private readonly resizeObserver: ResizeObserver
  private project: Project | null = null
  private tracks: Track[] = []
  private selectedTrack: Track | null = null
  private active = false
  private animationFrame = 0
  private geometryChanged = true
  private showingEmpty = true

  constructor(private readonly trackListController: TrackListController) {
    this.content.className = 'video-panel-content'
    const controls = document.createElement('div')
    controls.className = 'video-panel-controls'
    this.trackLabel.textContent = 'Video track'
    this.trackSelect.id = 'video-preview-track'
    this.trackLabel.htmlFor = this.trackSelect.id
    controls.append(this.trackLabel, this.trackSelect)
    this.stage.className = 'video-preview-stage'
    this.canvas.setAttribute('role', 'img')
    this.canvas.setAttribute('aria-label', 'Timeline video preview')
    this.status.className = 'video-preview-status'
    this.status.setAttribute('role', 'status')
    this.stage.append(this.canvas, this.status)
    this.content.append(controls, this.stage)
    this.preview = new VideoPreview(
      this.canvas,
      (message) => this.setStatus(message),
      (error) => {
        NotificationsController.showError(error)
      },
    )
    this.trackSelect.addEventListener('change', () => {
      this.selectedTrack = this.tracks[this.trackSelect.selectedIndex] ?? null
      this.preview.clear()
      this.geometryChanged = true
      this.showingEmpty = true
      this.updateTrackLabel()
      this.render()
    })
    this.resizeObserver = new ResizeObserver(() => {
      this.geometryChanged = true
    })
  }

  open(project: Project, track?: Track): void {
    this.deactivate()
    this.project = project
    this.active = true
    this.refreshData()
    if (track && this.tracks.includes(track)) this.selectedTrack = track
    this.updateTrackLabel()
    this.shell.open({
      owner: this,
      title: 'Video',
      subtitle: this.selectedTrack?.name ?? 'Timeline preview',
      body: this.content,
      onClose: () => this.deactivate(),
    })
    this.resizeObserver.observe(this.stage)
    this.tick()
  }

  close(): void {
    this.shell.close(this)
  }

  refreshData(project = this.project): void {
    if (!this.active || !project) return
    if (project !== this.project) {
      this.close()
      return
    }
    // Also called by the open panel's clock: saves and live placement edits need no permanent listeners.
    let count = 0
    let changed = false
    for (const track of project.getTracks()) {
      if (!track.clipViews.some((view) => view.clip.videoSegments.length > 0)) continue
      if (this.tracks[count] !== track) changed = true
      if (this.trackSelect.options[count]?.textContent !== track.name) changed = true
      ++count
    }
    if (count !== this.tracks.length) changed = true
    if (!changed) return
    this.tracks = project
      .getTracks()
      .filter((track) => track.clipViews.some((view) => view.clip.videoSegments.length > 0))
    if (!this.selectedTrack || !this.tracks.includes(this.selectedTrack)) {
      this.selectedTrack = this.tracks[0] ?? null
      this.preview.clear()
      this.showingEmpty = true
      this.geometryChanged = true
    }
    this.trackSelect.replaceChildren(
      ...this.tracks.map((track, index) => {
        const option = document.createElement('option')
        option.value = `${index}`
        option.textContent = track.name
        return option
      }),
    )
    this.updateTrackLabel()
  }

  private updateTrackLabel(): void {
    this.trackSelect.selectedIndex = this.selectedTrack ? this.tracks.indexOf(this.selectedTrack) : -1
    this.trackSelect.hidden = this.tracks.length < 2
    this.trackLabel.hidden = this.tracks.length < 2
    this.canvas.setAttribute(
      'aria-label',
      this.selectedTrack ? `Video preview: ${this.selectedTrack.name}` : 'Timeline video preview',
    )
    if (this.active) this.shell.setSubtitle(this.selectedTrack?.name ?? 'Timeline preview')
  }

  private readonly tick = (): void => {
    if (!this.active) return
    this.render()
    this.animationFrame = requestAnimationFrame(this.tick)
  }

  private render(): void {
    const project = this.project
    if (!this.active || !project) return
    this.refreshData()
    const state = AudioControl.getState()
    const recording = isRecordingState(state)
    this.trackSelect.disabled = recording
    if (recording) {
      this.showEmpty('Recording — timeline preview available after stop.')
      return
    }
    if (!this.selectedTrack) {
      this.showEmpty('Import a local video file or a video URL to preview it here. Use the timeline cursor to scrub.')
      return
    }
    const playing = state === AudioState.PLAYING || state === AudioState.PLAYING_PAUSED
    // A selected region owns the stopped cursor until marker dragging clears the selection.
    const sample = playing
      ? (AudioControl.audioContext?.getPosition() ?? AudioControl.startPosition)
      : (this.trackListController.selectedRegion?.startSample ?? AudioControl.startPosition)
    const target = resolveVideoFrame(this.selectedTrack.clipViews, sample, project.sampleRate)
    if (!target) {
      this.showEmpty('No video at this timeline position.')
      return
    }
    this.showingEmpty = false
    this.preview.request(
      project.directoryName,
      project.sampleRate,
      target,
      state === AudioState.PLAYING,
      this.geometryChanged,
    )
    this.geometryChanged = false
  }

  private showEmpty(message: string): void {
    if (!this.showingEmpty || this.status.textContent !== message) this.preview.clear()
    this.showingEmpty = true
    this.setStatus(message)
  }

  private setStatus(message: string): void {
    if (this.status.textContent !== message) this.status.textContent = message
    this.status.hidden = message.length === 0
  }

  private deactivate(): void {
    this.active = false
    cancelAnimationFrame(this.animationFrame)
    this.resizeObserver.disconnect()
    this.preview.clear()
    this.project = null
    this.geometryChanged = true
    this.showingEmpty = true
  }
}
