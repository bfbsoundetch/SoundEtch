import { Restorable } from '../persistence/Restoration'
import { DatabasePersisted } from '../persistence/DatabasePersisted'
import { Summary } from './Summary'

@Restorable('Clip')
export class Clip extends DatabasePersisted {
  readonly summary: Summary

  constructor(
    readonly name: string,
    private readonly channelCount: number,
    length = 0,
  ) {
    super(['summary'])
    this.summary = new Summary(this.channelCount)
    this.length = length
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
