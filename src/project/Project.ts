import { Track } from './Track'
import { Clip } from './Clip'
import { DatabasePersisted } from '../persistence/DatabasePersisted'
import { Restorable } from '../persistence/Restoration'

@Restorable('Project')
export class Project extends DatabasePersisted {
  private tracks: Track[] = []
  private clips: Clip[] = []

  description: string = ''

  constructor(
    public title: string,
    readonly sampleRate: number,
  ) {
    super([])
  }

  get directoryName(): string {
    return `${this.id}`
  }

  getTracks(): Track[] {
    return this.tracks
  }

  getClips(): Clip[] {
    return this.clips
  }

  addTrack(track: Track, index: number = this.tracks.length) {
    this.tracks.splice(index, 0, track)
    this.updateTrackAudibility()
  }

  addClip(clip: Clip) {
    this.clips.push(clip)
  }

  deleteClip(clip: Clip) {
    const index = this.clips.indexOf(clip)
    if (index >= 0) {
      this.clips.splice(index, 1)
    }
  }

  deleteTrack(track: Track) {
    const index = this.tracks.indexOf(track)
    if (index < 0) {
      return
    }
    this.tracks.splice(index, 1)
    track.stopPlayback()
    this.updateTrackAudibility()
  }

  setTrackMuted(track: Track, muted: boolean) {
    track.setMuted(muted)
    this.updateTrackAudibility()
  }

  setTrackSoloed(track: Track, soloed: boolean) {
    track.setSoloed(soloed)
    this.updateTrackAudibility()
  }

  isTrackAudible(track: Track): boolean {
    return !track.isMuted() && (!this.tracks.some((candidate) => candidate.isSoloed()) || track.isSoloed())
  }

  private updateTrackAudibility() {
    this.tracks.forEach((track) => track.setPlaybackAudible(this.isTrackAudible(track)))
  }

  getLength() {
    return Math.max(...this.tracks.map((t) => t.length))
  }
}
