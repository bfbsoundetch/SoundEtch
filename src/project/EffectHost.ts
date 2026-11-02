import type { OutputBus } from './OutputBus'
import type { Track } from './Track'

/**
 * Owner of an editable effect chain: a track, or the output that processes the mix of every track.
 * Tell them apart with `instanceof OutputBus`: tracks restored from the database are not `instanceof Track`.
 */
export type EffectHost = Track | OutputBus
