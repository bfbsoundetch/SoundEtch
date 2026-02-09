import { ClipView } from './ClipView'
import { DatabasePersisted } from '../persistence/DatabasePersisted'
import { Restorable } from '../persistence/Restoration'
import { Analyzable } from '../analyzers/Analyzable'
import { Effect } from '../effects/Effects'
import { ProjectManager } from './ProjectManager'

class Playback {
  constructor(
    readonly playerNode: AudioWorkletNode,
    readonly gainNode: GainNode,
    readonly pannerNode: StereoPannerNode,
    readonly effectNodes: Array<AudioNode>,
  ) {}
}

@Restorable('Track')
export class Track extends DatabasePersisted implements Analyzable {
  readonly clipViews: ClipView[] = []
  private playback: Playback | null = null
  private pan: number = 0
  private gain: number = 1
  private readonly effects: Effect[] = []

  constructor(
    public name: string,
    private readonly channelCount: number,
  ) {
    super(['playback'])
  }

  getChannelCount(): number {
    return this.channelCount
  }

  removeClipView(clipViewIndex: number) {
    this.clipViews.splice(clipViewIndex, 1)
  }

  async replaceClipView(clipViewIndex: number, newClipView: ClipView) {
    const old = this.clipViews.splice(clipViewIndex, 1)[0]
    if (!this.canAddClipView(newClipView)) {
      this.clipViews.splice(clipViewIndex, 0, old)
      return
    }
    this.addClipView(newClipView)
    await ProjectManager.saveTrack(this)
  }

  canAddClipView(newClipView: ClipView): boolean {
    if (newClipView.clip.getChannelCount() != this.channelCount) {
      return false
    }
    for (let i = 0; i < this.clipViews.length; ++i) {
      const clipView = this.clipViews[i]
      if (clipView.startPosition <= newClipView.startPosition) {
        if (clipView.startPosition + clipView.length > newClipView.startPosition) {
          console.error('this 1 ' + i)
          return false
        }
      } else {
        if (clipView.startPosition < newClipView.startPosition + newClipView.length) {
          console.error('this 2 ' + i)
          return false
        }
      }
    }
    return true
  }

  addClipView(newClipView: ClipView) {
    if (newClipView.clip.getChannelCount() != this.channelCount) {
      throw Error(
        'Clip has ' +
          newClipView.clip.getChannelCount() +
          ' channels, but track ' +
          this.name +
          ' has ' +
          this.channelCount,
      )
    }
    for (let i = 0; i < this.clipViews.length; ++i) {
      const clipView = this.clipViews[i]
      if (clipView.startPosition <= newClipView.startPosition) {
        if (clipView.startPosition + clipView.length > newClipView.startPosition) {
          throw Error('New clip appears in the middle of an existing clip!')
        }
      } else {
        if (clipView.startPosition < newClipView.startPosition + newClipView.length) {
          throw Error('New clip appears in the middle of an existing clip!')
        }
        this.clipViews.splice(i, 0, newClipView)
        return
      }
    }
    this.clipViews.push(newClipView)
  }

  split(clipViewIndex: number, position: number) {
    const clipView = this.clipViews[clipViewIndex]
    if (
      position <= this.clipViews[clipViewIndex].startPosition ||
      position >= this.clipViews[clipViewIndex].getEndPosition()
    ) {
      return
    }
    const firstLength = position - clipView.startPosition
    const firstNewClipView = new ClipView(clipView.clip, clipView.offset, clipView.startPosition, firstLength)
    const secondNewClipView = new ClipView(
      clipView.clip,
      clipView.offset + firstLength,
      position,
      clipView.length - firstLength,
    )
    this.clipViews.splice(clipViewIndex, 1, firstNewClipView, secondNewClipView)
  }

  slice(start: number, end: number, del: boolean): ClipView[] {
    if (start < 0 || start > end) {
      throw new Error('Must have 0 <= start <= end')
    }
    let startIndex = this.findClipViewIndexAfterPosition(start)
    if (startIndex >= this.clipViews.length) {
      return []
    }
    const startClipView = this.clipViews[startIndex]
    let endIndex = this.findClipViewIndexAfterPosition(end)
    let endClipView = null
    if (endIndex < this.clipViews.length) {
      endClipView = this.clipViews[endIndex]
    }

    let sliceStart: ClipView | null = null
    const newClipViews = []
    if (startClipView.startPosition < start) {
      newClipViews.push(
        new ClipView(
          startClipView.clip,
          startClipView.offset,
          startClipView.startPosition,
          start - startClipView.startPosition,
        ),
      )
      sliceStart = new ClipView(
        startClipView.clip,
        startClipView.offset + start - startClipView.startPosition,
        start,
        Math.min(startClipView.getEndPosition() - start, end - start),
      )
    }
    let sliceEnd: ClipView | null = null
    if (endClipView != null && endClipView.getEndPosition() > end) {
      newClipViews.push(
        new ClipView(
          endClipView.clip,
          endClipView.offset + end - endClipView.startPosition,
          end,
          endClipView.getEndPosition() - end,
        ),
      )
      if (endClipView != startClipView) {
        sliceEnd = new ClipView(
          endClipView.clip,
          endClipView.offset,
          endClipView.startPosition,
          end - endClipView.startPosition,
        )
      }
    }
    const slice = del
      ? this.clipViews.splice(startIndex, endIndex - startIndex + 1, ...newClipViews)
      : this.clipViews.slice(startIndex, endIndex + 1)

    if (sliceStart != null) {
      slice[0] = sliceStart
    }
    if (sliceEnd != null) {
      slice[slice.length - 1] = sliceEnd
    }
    return slice
  }

  registerNewPlayback(playerNode: AudioWorkletNode, gainNode: GainNode, pannerNode: StereoPannerNode) {
    this.playback = new Playback(playerNode, gainNode, pannerNode, [])
  }

  stopPlayback() {
    this.playback?.playerNode.disconnect()
    this.playback = null
  }

  setPan(pan: number) {
    if (this.playback) {
      this.playback.pannerNode.pan.value = pan
    }
    this.pan = pan
  }

  getPan(): number {
    return this.pan
  }

  setGain(gain: number) {
    if (this.playback) {
      this.playback.gainNode.gain.value = gain
    }
    this.gain = gain
  }

  getGain(): number {
    return this.gain
  }

  getLevel(): number {
    throw new Error('Method not implemented.')
  }

  getPeak(): number {
    throw new Error('Method not implemented.')
  }

  getHeldPeak(): number {
    throw new Error('Method not implemented.')
  }

  get length(): number {
    return this.clipViews.findLast((_) => true)?.getEndPosition() ?? 0
  }

  getClipViewAfterPosition(position: number): ClipView | null {
    const index = this.findClipViewIndexAfterPosition(position)
    if (index >= this.clipViews.length) {
      return null
    }
    return this.clipViews[index]
  }

  private findClipViewIndexAfterPosition(position: number): number {
    let i = 0
    for (; i < this.clipViews.length && this.clipViews[i].startPosition + this.clipViews[i].length <= position; ++i) {}
    return i
  }
}
