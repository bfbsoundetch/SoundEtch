export interface Analyzable {
  getLevel(): number
  getPeak(): number
  getHeldPeak(): number
  name: string
}
