import { EffectData } from '../../effects/EffectData'
import { ProjectManager } from '../../project/ProjectManager'
import { Track } from '../../project/Track'
import { Undoable } from '../undo/Undoable'

export function cloneEffectData(effectData: readonly EffectData[]) {
  return structuredClone(effectData) as EffectData[]
}

export class SetTrackEffectsCommand implements Undoable {
  private readonly oldEffects: EffectData[]
  private readonly newEffects: EffectData[]

  constructor(
    private readonly track: Track,
    oldEffects: readonly EffectData[],
    newEffects: readonly EffectData[],
    private readonly description: string,
  ) {
    this.oldEffects = cloneEffectData(oldEffects)
    this.newEffects = cloneEffectData(newEffects)
  }

  async perform() {
    this.track.setEffectRegions(cloneEffectData(this.newEffects))
    await this.track.applyPlaybackEffectSettings()
  }

  async undo() {
    this.track.setEffectRegions(cloneEffectData(this.oldEffects))
    await this.track.applyPlaybackEffectSettings()
  }

  async save() {
    await ProjectManager.saveTrack(this.track)
  }

  toString() {
    return this.description
  }
}
