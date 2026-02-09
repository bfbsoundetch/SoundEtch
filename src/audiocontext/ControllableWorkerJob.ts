import { AudioFileWritingJob } from '../recording/AudioFileWritingJob'
import { PlaybackJob } from '../playback/PlaybackJob'
import { AudioFilePublishingJob } from '../rendering/AudioFilePublishingJob'

export interface ControllableWorkerJob {
  start(): Promise<any>
  pause(): void
  resume(): void
  stop(): void
}

export enum JobType {
  RECORDER = 'recorder',
  PLAYER = 'player',
  PUBLISHER = 'publisher',
}

export class ControllableWorkerJobFactory {
  static async getControllableWorkerJob(jobType: JobType, argument: any): Promise<ControllableWorkerJob> {
    switch (jobType) {
      case JobType.RECORDER:
        return AudioFileWritingJob.create(argument)
      case JobType.PLAYER:
        return new PlaybackJob(argument)
      case JobType.PUBLISHER:
        return new AudioFilePublishingJob(argument)
    }
  }
}
