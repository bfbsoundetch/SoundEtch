import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import type { Project } from '../project/Project'
import { NotificationsController } from '../ui/NotificationsController'
import { VideoFileWriter } from './VideoFileWriter'
import { recordedVideoFilename, settleRecordedVideo } from './VideoRecordingSession'
import { readRecordedVideoSegment } from './VideoTrackRecorder'

/** Restores the footage of recordings cut off by closing the tab: clips still marked videoRecordingInProgress. */
export async function recoverInterruptedVideoRecordings(project: Project): Promise<void> {
  // A copy: settling deletes video-only clips without footage.
  for (const clip of project.getClips().filter((clip) => clip.videoRecordingInProgress)) {
    const filename = recordedVideoFilename(clip)
    try {
      const playable = await VideoFileWriter.trimInterruptedFile(project.directoryName, filename)
      const segment =
        playable > 0 ? await readRecordedVideoSegment(project.directoryName, filename, project.sampleRate) : null
      // Deleting the clip only removes the video files its segments list.
      if (!segment) await FileSystemUtils.deleteFile(project.directoryName, filename)
      await settleRecordedVideo(project, clip, segment)
    } catch (error) {
      // Another tab is still recording this clip and settles it itself.
      if (error instanceof DOMException && error.name == 'NoModificationAllowedError') continue
      // The marker stays, so the next load retries; the file is only deleted when nothing in it is playable.
      NotificationsController.showErrorMessage(
        `Could not recover the video recording of ${clip.name}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}
