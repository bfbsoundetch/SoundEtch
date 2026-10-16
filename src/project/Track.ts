import { ClipView } from './ClipView'
import { DatabasePersisted } from '../persistence/DatabasePersisted'
import { Restorable } from '../persistence/Restoration'
import { Analyzable } from '../analyzers/Analyzable'
import { EffectData } from 'effects/EffectData'
import { EffectChain } from '../effects/EffectChain'
import { SimpleAnalyzer } from '../analyzers/SimpleAnalyzer'
import { scheduleParameterValues } from '../effects/ParameterScheduling'

type PlaybackChangeListener = () => void

class Playback {
  constructor(
    readonly playerNode: AudioWorkletNode,
    readonly gainNode: GainNode,
    readonly pannerNode: StereoPannerNode,
    readonly effectChain: EffectChain | null,
    readonly cleanup: (() => void) | null,
    public audible: boolean,
  ) {}
}

@Restorable('Track')
export class Track extends DatabasePersisted implements Analyzable {
  readonly clipViews: ClipView[] = []
  readonly effectRegions = new Array<EffectData>()
  private playback: Playback | null = null
  private readonly playbackChangeListeners = new Set<PlaybackChangeListener>()
  private readonly analyzer = new SimpleAnalyzer()
  private pan: number = 0
  private gain: number = 1
  private muted = false
  private soloed = false

  constructor(
    public name: string,
    private readonly channelCount: number,
  ) {
    super(['playback', 'analyzer', 'playbackChangeListeners'])
  }

  getChannelCount(): number {
    return this.channelCount
  }

  removeClipView(clipViewIndex: number) {
    this.clipViews.splice(clipViewIndex, 1)
  }

  replaceClipView(clipViewIndex: number, newClipView: ClipView): boolean {
    if (clipViewIndex < 0 || clipViewIndex >= this.clipViews.length) {
      return false
    }
    const old = this.clipViews.splice(clipViewIndex, 1)[0]
    if (!old) {
      return false
    }
    if (!this.canAddClipView(newClipView)) {
      this.clipViews.splice(clipViewIndex, 0, old)
      return false
    }
    this.addClipView(newClipView)
    return true
  }

  canReplaceClipView(clipViewIndex: number, newClipView: ClipView): boolean {
    if (clipViewIndex < 0 || clipViewIndex >= this.clipViews.length) {
      return false
    }
    const old = this.clipViews.splice(clipViewIndex, 1)[0]
    if (!old) {
      return false
    }
    const canReplace = this.canAddClipView(newClipView)
    this.clipViews.splice(clipViewIndex, 0, old)
    return canReplace
  }

  canAddClipView(newClipView: ClipView): boolean {
    if (newClipView.clip.getChannelCount() != this.channelCount) {
      return false
    }

    let latestOverlapEnd = -Infinity
    for (const clipView of this.clipViews) {
      const overlapStart = Math.max(clipView.startPosition, newClipView.startPosition)
      const overlapEnd = Math.min(clipView.getEndPosition(), newClipView.getEndPosition())
      if (overlapStart >= overlapEnd) {
        continue
      }
      if (overlapStart < latestOverlapEnd) {
        return false
      }
      latestOverlapEnd = Math.max(latestOverlapEnd, overlapEnd)
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
    if (!this.canAddClipView(newClipView)) {
      throw Error('New clip would overlap two existing clips!')
    }
    for (let i = 0; i < this.clipViews.length; ++i) {
      const clipView = this.clipViews[i]
      if (clipView.startPosition > newClipView.startPosition) {
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

    const slice = this.clipViews.flatMap((clipView) => {
      const sliceStart = Math.max(start, clipView.startPosition)
      const sliceEnd = Math.min(end, clipView.getEndPosition())
      if (sliceStart >= sliceEnd) {
        return []
      }
      return [
        new ClipView(
          clipView.clip,
          clipView.offset + sliceStart - clipView.startPosition,
          sliceStart,
          sliceEnd - sliceStart,
        ),
      ]
    })
    if (!del || slice.length == 0) {
      return slice
    }

    const clipsCrossingStart = this.clipViews.filter(
      (clipView) => clipView.startPosition < start && clipView.getEndPosition() > start,
    )
    const clipsCrossingEnd = this.clipViews.filter(
      (clipView) => clipView.startPosition < end && clipView.getEndPosition() > end,
    )
    const keepLeft = clipsCrossingStart.reduce<ClipView | null>((longest, clipView) => {
      return longest == null || clipView.startPosition < longest.startPosition ? clipView : longest
    }, null)
    const keepRight = clipsCrossingEnd.reduce<ClipView | null>((longest, clipView) => {
      return longest == null || clipView.getEndPosition() > longest.getEndPosition() ? clipView : longest
    }, null)

    const remainingClipViews = this.clipViews.flatMap((clipView) => {
      const fragments = new Array<ClipView>()
      if (clipView.startPosition < start && (clipsCrossingStart.length < 2 || clipView == keepLeft)) {
        fragments.push(
          new ClipView(
            clipView.clip,
            clipView.offset,
            clipView.startPosition,
            Math.min(start, clipView.getEndPosition()) - clipView.startPosition,
          ),
        )
      }
      if (clipView.getEndPosition() > end && (clipsCrossingEnd.length < 2 || clipView == keepRight)) {
        const fragmentStart = Math.max(end, clipView.startPosition)
        fragments.push(
          new ClipView(
            clipView.clip,
            clipView.offset + fragmentStart - clipView.startPosition,
            fragmentStart,
            clipView.getEndPosition() - fragmentStart,
          ),
        )
      }
      return fragments
    })
    remainingClipViews.sort((a, b) => a.startPosition - b.startPosition)
    this.clipViews.splice(0, this.clipViews.length, ...remainingClipViews)
    return slice
  }

  registerNewPlayback(
    playerNode: AudioWorkletNode,
    gainNode: GainNode,
    pannerNode: StereoPannerNode,
    effectChain: EffectChain | null = null,
    cleanup: (() => void) | null = null,
    audible = true,
  ) {
    const audioContext = playerNode.context
    const handleContextStateChange = () => {
      if (audioContext.state == 'closed' && this.playback?.playerNode == playerNode) {
        this.stopPlayback()
      }
    }
    audioContext.addEventListener('statechange', handleContextStateChange)
    const playbackCleanup = () => {
      audioContext.removeEventListener('statechange', handleContextStateChange)
      cleanup?.()
    }
    this.playback = new Playback(playerNode, gainNode, pannerNode, effectChain, playbackCleanup, audible)
    // Bypass may have changed while the playback graph was being built.
    this.applyPlaybackEffectBypass()
    gainNode.gain.value = audible ? this.gain : 0
    this.notifyPlaybackChange()
  }

  attachAnalyzer(inputNode: AudioNode) {
    return this.analyzer.attachAnalyzer(inputNode)
  }

  stopPlayback() {
    const playback = this.playback
    if (!playback) {
      return
    }
    this.playback = null
    playback.cleanup?.()
    playback.playerNode.disconnect()
    playback.effectChain?.disconnect()
    this.notifyPlaybackChange()
  }

  getPlaybackEffect(instanceId: string) {
    const effect = this.playback?.effectChain?.getEffect(instanceId)
    return effect && effect.audioContext.state != 'closed' ? effect : null
  }

  getPlaybackEffectModule(instanceId: string) {
    return this.getPlaybackEffect(instanceId)?.module ?? null
  }

  addPlaybackChangeListener(listener: PlaybackChangeListener) {
    this.playbackChangeListeners.add(listener)
    return () => this.playbackChangeListeners.delete(listener)
  }

  private notifyPlaybackChange() {
    this.playbackChangeListeners.forEach((listener) => listener())
  }

  async applyPlaybackEffectSettings() {
    const effectChain = this.playback?.effectChain
    if (!effectChain) {
      return
    }
    this.applyPlaybackEffectBypass()
    for (const effectData of this.effectRegions) {
      const playbackEffect = effectChain.getEffect(effectData.instanceId)
      if (!playbackEffect) {
        continue
      }
      playbackEffect.module.setState?.(effectData.state)
      const parameters = await playbackEffect.module.getParameters(playbackEffect.audioContext)
      const position =
        'getPosition' in playbackEffect.audioContext ? (playbackEffect.audioContext.getPosition as () => number)() : 0
      for (const [name, sequence] of Object.entries(effectData.params)) {
        const parameter = parameters[name]
        if (!parameter) {
          continue
        }
        if (sequence.transitionSequence.length > 0) {
          scheduleParameterValues(parameter, sequence, playbackEffect.audioContext, position)
        } else {
          parameter.setValueAtTime(sequence.initialValue, playbackEffect.audioContext.currentTime)
        }
      }
    }
  }

  private applyPlaybackEffectBypass() {
    const effectChain = this.playback?.effectChain
    for (const effectData of this.effectRegions) {
      effectChain?.setBypassed(effectData.instanceId, effectData.bypassed ?? false)
    }
  }

  setEffectRegions(effectRegions: readonly EffectData[]) {
    this.effectRegions.splice(0, this.effectRegions.length, ...effectRegions)
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
      this.playback.gainNode.gain.value = this.playback.audible ? gain : 0
    }
    this.gain = gain
  }

  getGain(): number {
    return this.gain
  }

  setMuted(muted: boolean) {
    this.muted = muted
  }

  isMuted(): boolean {
    return this.muted
  }

  setSoloed(soloed: boolean) {
    this.soloed = soloed
  }

  isSoloed(): boolean {
    return this.soloed
  }

  setPlaybackAudible(audible: boolean) {
    if (!this.playback) {
      return
    }
    this.playback.audible = audible
    this.playback.gainNode.gain.value = audible ? this.gain : 0
  }

  getLevel(channel = 0): number {
    return this.analyzer.getLevel(channel)
  }

  getPeak(channel = 0): number {
    return this.analyzer.getPeak(channel)
  }

  getHeldPeak(channel = 0): number {
    return this.analyzer.getHeldPeak(channel)
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
