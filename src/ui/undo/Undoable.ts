export interface Undoable {
  perform(): Promise<any>
  undo(): Promise<any>
  save(): Promise<any>
}
