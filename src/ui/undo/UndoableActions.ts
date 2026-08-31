import { ClipView } from '../../project/ClipView'
import { Project } from '../../project/Project'
import { ProjectManager } from '../../project/ProjectManager'
import { Track } from '../../project/Track'
import { Undoable } from './Undoable'

export type UndoableAction =
  | AddClipViewCommand
  | RemoveClipViewCommand
  | ReplaceClipViewCommand
  | MoveClipViewBetweenTracksCommand
  | MoveClipViewToNewTrackCommand
  | SetTrackClipViewsCommand
  | SetTrackPropertyCommand
  | BatchCommand

export class BatchCommand implements Undoable {
  constructor(
    private readonly actions: Undoable[],
    private readonly description: string,
  ) {}

  async perform() {
    for (const action of this.actions) {
      await action.perform()
    }
  }

  async undo() {
    for (let i = this.actions.length - 1; i >= 0; --i) {
      await this.actions[i].undo()
    }
  }

  async save() {
    for (const action of this.actions) {
      await action.save()
    }
  }

  toString() {
    return this.description
  }
}

export class AddClipViewCommand implements Undoable {
  constructor(
    private readonly clipView: ClipView,
    private readonly track: Track,
  ) {}

  async perform() {
    this.track.addClipView(this.clipView)
  }

  async undo() {
    removeClipViewByReference(this.track, this.clipView)
  }

  async save() {
    await ProjectManager.saveTrack(this.track)
  }

  toString() {
    return 'add clip view'
  }
}

export class RemoveClipViewCommand implements Undoable {
  constructor(
    private readonly clipView: ClipView,
    private readonly track: Track,
  ) {}

  async perform() {
    removeClipViewByReference(this.track, this.clipView)
  }

  async undo() {
    this.track.addClipView(this.clipView)
  }

  async save() {
    await ProjectManager.saveTrack(this.track)
  }

  toString() {
    return 'remove clip view'
  }
}

export class ReplaceClipViewCommand implements Undoable {
  constructor(
    private readonly track: Track,
    private readonly oldClipView: ClipView,
    private readonly newClipView: ClipView,
    private readonly description: string,
  ) {}

  async perform() {
    this.replace(this.oldClipView, this.newClipView)
  }

  async undo() {
    this.replace(this.newClipView, this.oldClipView)
  }

  async save() {
    await ProjectManager.saveTrack(this.track)
  }

  toString() {
    return this.description
  }

  private replace(oldClipView: ClipView, newClipView: ClipView) {
    const oldClipViewIndex = this.track.clipViews.indexOf(oldClipView)
    if (oldClipViewIndex < 0 || !this.track.replaceClipView(oldClipViewIndex, newClipView)) {
      throw new Error('Could not ' + this.description)
    }
  }
}

export class MoveClipViewBetweenTracksCommand implements Undoable {
  constructor(
    private readonly oldTrack: Track,
    private readonly newTrack: Track,
    private readonly oldClipView: ClipView,
    private readonly newClipView: ClipView,
  ) {}

  async perform() {
    moveClipView(this.oldTrack, this.newTrack, this.oldClipView, this.newClipView)
  }

  async undo() {
    moveClipView(this.newTrack, this.oldTrack, this.newClipView, this.oldClipView)
  }

  async save() {
    await saveTracks(this.oldTrack, this.newTrack)
  }

  toString() {
    return 'move clip view between tracks'
  }
}

export class MoveClipViewToNewTrackCommand implements Undoable {
  private newTrackIsActive = false

  constructor(
    private readonly project: Project,
    private readonly oldTrack: Track,
    private readonly newTrack: Track,
    private readonly oldClipView: ClipView,
    private readonly newClipView: ClipView,
    private readonly newTrackIndex: number,
  ) {}

  async perform() {
    moveClipView(this.oldTrack, this.newTrack, this.oldClipView, this.newClipView)
    this.project.addTrack(this.newTrack, this.newTrackIndex)
    this.newTrackIsActive = true
  }

  async undo() {
    this.project.deleteTrack(this.newTrack)
    moveClipView(this.newTrack, this.oldTrack, this.newClipView, this.oldClipView)
    this.newTrackIsActive = false
  }

  async save() {
    if (this.newTrackIsActive) {
      await saveTracks(this.oldTrack, this.newTrack)
      await ProjectManager.saveProject(this.project)
      return
    }

    await ProjectManager.saveTrack(this.oldTrack)
    await ProjectManager.deleteTrack(this.newTrack)
  }

  toString() {
    return 'move clip view to new track'
  }
}

export class SetTrackClipViewsCommand implements Undoable {
  constructor(
    private readonly track: Track,
    private readonly oldClipViews: ClipView[],
    private readonly newClipViews: ClipView[],
  ) {}

  async perform() {
    setTrackClipViews(this.track, this.newClipViews)
  }

  async undo() {
    setTrackClipViews(this.track, this.oldClipViews)
  }

  async save() {
    await ProjectManager.saveTrack(this.track)
  }

  toString() {
    return 'set track clip views'
  }
}

export class SetTrackPropertyCommand implements Undoable {
  constructor(
    private readonly track: Track,
    private readonly property: TrackProperty,
    private readonly oldVal: string | number,
    private readonly newVal: string | number,
  ) {}

  async perform() {
    this.setValue(this.newVal)
  }

  async undo() {
    this.setValue(this.oldVal)
  }

  async save() {
    await ProjectManager.saveTrack(this.track)
  }

  toString() {
    return `Set track ${this.property}`
  }

  private setValue(value: string | number) {
    switch (this.property) {
      case TrackProperty.TITLE:
        this.track.name = String(value)
        break
      case TrackProperty.PAN:
        this.track.setPan(Number(value))
        break
      case TrackProperty.GAIN:
        this.track.setGain(Number(value))
        break
    }
  }
}

export enum TrackProperty {
  TITLE = 'title',
  PAN = 'pan',
  GAIN = 'gain',
}

export function clipViewsEqual(a: ClipView, b: ClipView) {
  return (
    a.clip === b.clip && a.offset === b.offset && a.startPosition === b.startPosition && a.viewLength === b.viewLength
  )
}

function moveClipView(fromTrack: Track, toTrack: Track, fromClipView: ClipView, toClipView: ClipView) {
  removeClipViewByReference(fromTrack, fromClipView)
  try {
    toTrack.addClipView(toClipView)
  } catch (error) {
    fromTrack.addClipView(fromClipView)
    throw error
  }
}

function removeClipViewByReference(track: Track, clipView: ClipView) {
  const clipViewIndex = track.clipViews.indexOf(clipView)
  if (clipViewIndex < 0) {
    throw new Error('Clip view not found')
  }
  track.removeClipView(clipViewIndex)
}

function setTrackClipViews(track: Track, clipViews: ClipView[]) {
  track.clipViews.splice(0, track.clipViews.length, ...clipViews)
}

async function saveTracks(...tracks: Track[]) {
  await Promise.all([...new Set(tracks)].map((track) => ProjectManager.saveTrack(track)))
}
