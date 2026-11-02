import type { EffectChain } from '../effects/EffectChain'
import type { EffectData } from '../effects/EffectData'
import type { Project } from './Project'

type PlaybackChangeListener = () => void

interface Playback {
  readonly effectChain: EffectChain
  readonly cleanup: () => void
}

const outputBuses = new WeakMap<Project, OutputBus>()

/**
 * A project's output: every track plays into it, and its effect chain processes the mix before the speakers.
 * The chain itself is `project.outputEffects`; this object only holds what the current playback is running.
 */
export class OutputBus {
  readonly name = 'Output'
  private playback: Playback | null = null
  private readonly playbackChangeListeners = new Set<PlaybackChangeListener>()

  static of(project: Project): OutputBus {
    let outputBus = outputBuses.get(project)
    if (!outputBus) {
      outputBus = new OutputBus(project)
      outputBuses.set(project, outputBus)
    }
    return outputBus
  }

  private constructor(readonly project: Project) {}

  get effectRegions(): EffectData[] {
    return this.project.outputEffects
  }

  setEffectRegions(effectRegions: readonly EffectData[]) {
    this.project.outputEffects.splice(0, this.project.outputEffects.length, ...effectRegions)
  }

  registerNewPlayback(effectChain: EffectChain, audioContext: BaseAudioContext) {
    this.stopPlayback()
    const handleContextStateChange = () => {
      if (audioContext.state == 'closed' && this.playback?.effectChain == effectChain) {
        this.stopPlayback()
      }
    }
    audioContext.addEventListener('statechange', handleContextStateChange)
    this.playback = {
      effectChain,
      cleanup: () => audioContext.removeEventListener('statechange', handleContextStateChange),
    }
    // Bypass may have changed while the playback graph was being built.
    effectChain.applyBypass(this.effectRegions)
    this.notifyPlaybackChange()
  }

  stopPlayback() {
    const playback = this.playback
    if (!playback) {
      return
    }
    this.playback = null
    playback.cleanup()
    playback.effectChain.disconnect()
    this.notifyPlaybackChange()
  }

  getPlaybackEffect(instanceId: string) {
    const effect = this.playback?.effectChain.getEffect(instanceId)
    return effect && effect.audioContext.state != 'closed' ? effect : null
  }

  addPlaybackChangeListener(listener: PlaybackChangeListener) {
    this.playbackChangeListeners.add(listener)
    return () => this.playbackChangeListeners.delete(listener)
  }

  async applyPlaybackEffectSettings() {
    await this.playback?.effectChain.applySettings(this.effectRegions)
  }

  private notifyPlaybackChange() {
    this.playbackChangeListeners.forEach((listener) => listener())
  }
}
