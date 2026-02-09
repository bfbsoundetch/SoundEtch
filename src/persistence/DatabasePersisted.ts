export abstract class DatabasePersisted {
  readonly dbPersisted = true
  readonly id: number | undefined = undefined
  protected readonly version: number | null = null

  constructor(private readonly ignoredFields: Array<string>) {}
}
