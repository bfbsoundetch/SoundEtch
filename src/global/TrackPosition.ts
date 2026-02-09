import { checkIsPositive, checkIsNonNegative } from './NumberUtils'

/** */
export class TrackPosition {
  sampleRate: number
  sampleCount: number = 0

  /**
   * @param {number} sampleRate The sample rate, in Hertz, for this track.
   * @param {number} sampleCount The number of samples from the beginning that this represents.
   */
  private constructor(sampleRate: number, sampleCount: number) {
    checkIsPositive(sampleRate)
    checkIsNonNegative(sampleCount)
    this.sampleRate = sampleRate
    this.sampleCount = sampleCount
  }

  /**
   * Creates a new TrackPosition at the beginning of the track, i.e. position
   * zero.
   * @param {number} sampleRate The sample rate, in Hertz, for this track.
   * @return {TrackPosition} The new TrackPosition object.
   */
  public static createAtBeginning(sampleRate: number): TrackPosition {
    checkIsPositive(sampleRate)
    return new TrackPosition(sampleRate, 0)
  }

  /**
   * Creates a new TrackPosition at the given position.
   * @param {number} sampleRate The sample rate, in Hertz, for this track.
   * @param {number} ms The position, in milliseconds, at which to create this
   * TrackPosition.
   * @return {TrackPosition} The new TrackPosition object.
   */
  public static createAtPosition(sampleRate: number, ms: number): TrackPosition {
    checkIsPositive(sampleRate)
    checkIsNonNegative(ms)
    const result = new TrackPosition(sampleRate, TrackPosition.getSamplesFromMilliseconds(sampleRate, ms))
    result.updateFromMilliseconds(ms)
    return result
  }

  public static create(sampleRate: number, sampleCount: number) {
    return new TrackPosition(sampleRate, sampleCount)
  }

  /**
   * Changes the sample rate while keeping the same position.
   * @param {number} newSampleRate The new sample rate.
   */
  public changeSampleRate(newSampleRate: number) {
    checkIsPositive(newSampleRate)
    this.sampleCount = Math.round((this.sampleCount * newSampleRate) / this.sampleRate)
    this.sampleRate = newSampleRate
  }

  /**
   * Change this position to the given value.
   * @param {number} ms The new position, in milliseconds.
   */
  public updateFromMilliseconds(ms: number) {
    this.sampleCount = TrackPosition.getSamplesFromMilliseconds(this.sampleRate, ms)
  }

  private static getSamplesFromMilliseconds(sampleRate: number, ms: number): number {
    checkIsNonNegative(ms)
    return Math.trunc((ms * sampleRate) / 1000)
  }

  /**
   * Converts this track position to a duration, in milliseconds.
   * @return {number} The number of milliseconds representing this position,
   * rounded down.
   */
  public toMilliseconds(): number {
    return Math.trunc((this.sampleCount / this.sampleRate) * 1000)
  }

  /**
   * Converts this track position to a duration, in seconds.
   * @return {number} The number of seconds representing this position, rounded
   * down.
   */
  public toSeconds(): number {
    return Math.trunc(this.toMilliseconds() / 1000)
  }

  /**
   * Converts this track position to a duration, in minutes.
   * @return {number} The number of minutes representing this position, rounded
   * down.
   */
  public toMinutes(): number {
    return Math.trunc(this.toSeconds() / 60)
  }

  /**
   * Converts this track position to a duration, in hours.
   * @return {number} The number of hours representing this position, rounded
   * down.
   */
  public toHours(): number {
    return Math.trunc(this.toMinutes() / 60)
  }

  /**
   * Converts this track position to a duration, in days.
   * @return {number} The number of days representing this position, rounded
   * down.
   */
  public toDays(): number {
    return Math.trunc(this.toHours() / 24)
  }

  /**
   * Gets the string representation of this TrackPosition.
   * @return {string} The string representation.
   */
  public toString(): string {
    const days = this.toDays()
    const daysString = days === 0 ? '' : `${days}D `
    const hours = this.toHours()
    const hoursString = hours === 0 ? '' : `${hours % 24}H `
    const minutes = this.toMinutes()
    const minutesString = minutes === 0 ? '' : `${minutes % 60}M `
    const seconds = this.toSeconds()
    const milliseconds = this.toMilliseconds()
    const secondsString = `${seconds % 60}.${(milliseconds % 1000).toString().padStart(3, '0')}S`
    return daysString + hoursString + minutesString + secondsString
  }

  public toIsoString(): string {
    return new Date(this.toMilliseconds()).toISOString().substring(11, 23)
  }
}
