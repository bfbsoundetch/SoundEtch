import { Restorable } from '../persistence/Restoration'
import { Clip } from './Clip'

@Restorable('ClipView')
export class ClipView {
  constructor(
    readonly clip: Clip,
    readonly offset: number,
    readonly startPosition: number,
    readonly viewLength: number,
  ) {}

  getEndPosition(): number {
    return this.startPosition + this.length
  }

  get length(): number {
    return Math.min(this.viewLength, this.clip.length - this.offset)
  }
}

export function cloneClipViewWithNewStartPosition(old: ClipView, shift: number): ClipView {
  return new ClipView(old.clip, old.offset, old.startPosition + shift, old.viewLength)
}
