import { Restorable } from '../persistence/Restoration'
import { DatabasePersisted } from '../persistence/DatabasePersisted'
import { Summary } from './Summary'
import type { TranscribedRange } from './Transcription'

@Restorable('Clip')
export class Clip extends DatabasePersisted {
  readonly summary: Summary
  transcription: TranscribedRange[] = []
  importedMetadata: Record<string, unknown> | null = null
  readonly tags: Record<string, string>
  readonly sourceFilename: string | null

  constructor(
    public name: string,
    private readonly channelCount: number,
    length = 0,
    tags: Record<string, string> = {},
    sourceFilename: string | null = null,
  ) {
    super(['summary'])
    this.summary = new Summary(this.channelCount)
    this.length = length
    this.tags = { ...tags }
    this.sourceFilename = sourceFilename
  }

  get length(): number {
    return this.summary.length
  }

  set length(length: number) {
    this.summary.length = length
  }

  getChannelCount(): number {
    return this.channelCount
  }

  get filename(): string {
    return `${this.id}`
  }
}
