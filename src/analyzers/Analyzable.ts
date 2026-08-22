export interface Analyzable {
  getLevel(channel?: number): number
  getPeak(channel?: number): number
  getHeldPeak(channel?: number): number
  name: string
}
