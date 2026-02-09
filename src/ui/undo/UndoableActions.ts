import { ClipView } from '../../project/ClipView'
import { Undoable } from './Undoable'
import { Track } from '../../project/Track'
import { ProjectManager } from '../../project/ProjectManager'

export type UndoableAction =
  | ChangeClipView
  | AddClipView
  | RemoveClipView
  | AddTrack
  | RemoveTrack
  | ChangeTrackProperty

export class ChangeClipView implements Undoable {
  private readonly removeClipView: RemoveClipView
  private readonly addClipView: AddClipView

  constructor(oldClipView: ClipView, newClipView: ClipView, oldTrack: Track, newTrack: Track) {
    this.removeClipView = new RemoveClipView(oldClipView, oldTrack)
    this.addClipView = new AddClipView(newClipView, newTrack)
  }

  async perform(): Promise<any> {
    await this.removeClipView.perform()
    await this.addClipView.perform()
  }
  async undo(): Promise<any> {
    await this.addClipView.undo()
    await this.removeClipView.undo()
  }
  async save(): Promise<any> {
    await Promise.all([this.addClipView.save(), this.removeClipView.save()])
  }
  toString(): string {
    return `Change clip view`
  }
}

export class AddClipView implements Undoable {
  constructor(
    private readonly clipView: ClipView,
    private readonly track: Track,
  ) {}

  async perform(): Promise<any> {
    this.track.addClipView(this.clipView)
  }
  async undo(): Promise<any> {
    const index = this.track.clipViews.indexOf(this.clipView)
    this.track.removeClipView(index)
  }
  async save(): Promise<any> {
    await ProjectManager.saveTrack(this.track)
  }
  toString(): string {
    return `Add clip view`
  }
}
export class RemoveClipView implements Undoable {
  private readonly addClipView: AddClipView

  constructor(clipView: ClipView, track: Track) {
    this.addClipView = new AddClipView(clipView, track)
  }

  perform(): Promise<any> {
    return this.addClipView.undo()
  }
  undo(): Promise<any> {
    return this.addClipView.perform()
  }
  async save(): Promise<any> {
    return this.addClipView.save()
  }
  toString(): string {
    return `Remove clip view`
  }
}
export class AddTrack implements Undoable {
  constructor(private readonly track: Track) {}

  async perform(): Promise<any> {
    ;(await ProjectManager.getActiveProject()).addTrack(this.track)
  }
  async undo(): Promise<any> {
    ;(await ProjectManager.getActiveProject()).deleteTrack(this.track)
  }
  async save(): Promise<any> {
    await ProjectManager.saveProject()
  }
  toString(): string {
    return `Add track`
  }
}
export class RemoveTrack implements Undoable {
  private readonly addTrackAction: AddTrack

  constructor(track: Track) {
    this.addTrackAction = new AddTrack(track)
  }

  perform(): Promise<any> {
    return this.addTrackAction.undo()
  }
  undo(): Promise<any> {
    return this.addTrackAction.perform()
  }
  async save(): Promise<any> {
    await this.addTrackAction.save()
  }
  toString(): string {
    return `Remove track`
  }
}
export class ChangeTrackProperty implements Undoable {
  constructor(
    private readonly track: Track,
    private readonly property: TrackProperty,
    private readonly oldVal: any,
    private readonly newVal: any,
  ) {}

  async perform(): Promise<any> {
    switch (this.property) {
      case TrackProperty.TITLE:
        this.track.name = this.newVal
        break
      case TrackProperty.PAN:
        this.track.setPan(this.newVal)
        break
      case TrackProperty.GAIN:
        this.track.setGain(this.newVal)
        break
    }
  }
  async undo(): Promise<any> {
    switch (this.property) {
      case TrackProperty.TITLE:
        this.track.name = this.oldVal
        break
      case TrackProperty.PAN:
        this.track.setPan(this.oldVal)
        break
      case TrackProperty.GAIN:
        this.track.setGain(this.oldVal)
        break
    }
  }
  async save(): Promise<any> {
    await ProjectManager.saveTrack(this.track)
  }
  toString(): string {
    return `Change track's ${this.property} to ${this.newVal}`
  }
}

export enum TrackProperty {
  TITLE = 'title',
  PAN = 'pan',
  GAIN = 'gain',
}
