export abstract class DatabasePersisted {
  readonly dbPersisted = true
  readonly id: number | undefined = undefined
  readonly dateCreated: number | undefined = undefined
  readonly dateModified: number | undefined = undefined
  protected readonly version: number | null = null

  constructor(private readonly ignoredFields: Array<string>) {}
}
