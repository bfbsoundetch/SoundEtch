import { Project } from '../project/Project'
import { Track } from '../project/Track'
import type { EffectData } from '../effects/EffectData'
import { RenderingArgument } from './RenderingWorkerProtocol'

/** `outputEffects` process the sum of `tracks`: the project's output chain for exports, none for Freeze. */
export function createRenderingArgument(
  project: Project,
  outputChannelCount: number,
  startPosition: number,
  projectLength: number,
  tracks: Array<Track>,
  outputEffects: readonly EffectData[],
): RenderingArgument {
  return {
    projectId: project.id!,
    sampleRate: project.sampleRate,
    channelCount: outputChannelCount,
    startPosition: startPosition,
    length: projectLength,
    trackSubsets: tracks.map((track) => {
      return {
        name: track.name,
        length: track.length,
        channelCount: track.getChannelCount(),
        clipViews: track.clipViews
          .filter((clipView) => clipView.clip.audioPresent && clipView.offset < clipView.clip.summary.length)
          .map((clipView) => ({
            startPosition: clipView.startPosition,
            offset: clipView.offset,
            length: Math.max(0, Math.min(clipView.length, clipView.clip.summary.length - clipView.offset)),
            clip: {
              id: clipView.clip.id!,
              channelCount: clipView.clip.getChannelCount(),
            },
          })),
        gain: project.isTrackAudible(track) ? track.getGain() : 0,
        pan: track.getPan(),
        effects: structuredClone(track.effectRegions),
      }
    }),
    outputEffects: structuredClone(outputEffects) as EffectData[],
  }
}
