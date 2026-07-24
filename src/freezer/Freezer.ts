import { Track } from '../project/Track'
import { SelectedRegion } from '../playback/Player'
import { Clip } from '../project/Clip'
import { ProjectManager } from '../project/ProjectManager'
import { Renderer } from '../rendering/Renderer'

export class Freezer {
  static async freezeSelection(selection: SelectedRegion): Promise<Track> {
    const length = selection.endSample - selection.startSample
    if (length <= 0 || selection.tracks.length == 0) {
      throw new Error('Select some audio to freeze')
    }

    const project = await ProjectManager.getActiveProject()
    const channelCount = Math.max(...selection.tracks.map((track) => track.getChannelCount()))
    const sourceName = selection.tracks.length == 1 ? selection.tracks[0].name : `${selection.tracks.length} tracks`
    const clip = new Clip(`Freeze: ${sourceName}`, channelCount)
    clip.importedMetadata = {
      source: 'Freeze',
      sourceTrackIds: selection.tracks.map((track) => track.id),
      startSample: selection.startSample,
      endSample: selection.endSample,
    }
    await ProjectManager.addNewClip(clip)

    try {
      await Renderer.renderToClip(project, clip, selection.startSample, length, ...selection.tracks)
      await ProjectManager.saveClip(clip)
      return await ProjectManager.addExistingClipWithTrack(clip, selection.startSample)
    } catch (error) {
      await ProjectManager.deleteClip(clip)
      throw error
    }
  }

  static cancelFreeze() {
    Renderer.cancelRender()
  }
}
