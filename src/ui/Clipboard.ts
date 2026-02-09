import { ClipView } from '../project/ClipView'

export class Clipboard {
  static copiedClipViews: Array<Array<ClipView>> | null = null
  static copyStartPosition: number | null = null
}
