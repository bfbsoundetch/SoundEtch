export interface Undoable {
  perform(): Promise<void>
  undo(): Promise<void>
  save(): Promise<void>
}
