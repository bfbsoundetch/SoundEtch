import { Project } from '../project/Project'
import { Track } from '../project/Track'
import { RenderingArgument } from './RenderingWorkerProtocol'

export function createRenderingArgument(
  project: Project,
  outputChannelCount: number,
  startPosition: number,
  projectLength: number,
  tracks: Array<Track>,
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
        clipViews: track.clipViews.map((clipView) => {
          return {
            startPosition: clipView.startPosition,
            offset: clipView.offset,
            length: clipView.length,
            clip: {
              id: clipView.clip.id!,
              channelCount: clipView.clip.getChannelCount(),
            },
          }
        }),
        gain: track.getGain(),
        pan: track.getPan(),
      }
    }),
  }
}
