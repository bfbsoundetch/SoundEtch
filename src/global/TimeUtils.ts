export class TimeUtils {
  /**
   * Converts this number of milliseconds to a duration, in seconds.
   */
  static toSeconds(ms: number): number {
    return Math.trunc(ms / 1000)
  }

  /**
   * Converts this number of milliseconds to a duration, in minutes.
   */
  static toMinutes(ms: number): number {
    return Math.trunc(TimeUtils.toSeconds(ms) / 60)
  }

  /**
   * Converts this number of milliseconds to a duration, in hours.
   */
  static toHours(ms: number): number {
    return Math.trunc(TimeUtils.toMinutes(ms) / 60)
  }

  /**
   * Converts this number of milliseconds to a duration, in days.
   */
  static toDays(ms: number): number {
    return Math.trunc(TimeUtils.toHours(ms) / 24)
  }

  static positionToString(samples: number, sampleRate: number, removeZeroes: boolean): string {
    return TimeUtils.toString(Math.round((samples * 1000) / sampleRate), removeZeroes)
  }

  static toString(ms: number, removeZeroes: boolean): string {
    const sign = ms < 0 ? '-' : ''
    ms = Math.abs(ms)
    const days = TimeUtils.toDays(ms)
    const hours = TimeUtils.toHours(ms)
    const minutes = TimeUtils.toMinutes(ms)
    const seconds = TimeUtils.toSeconds(ms)
    const daysString = days === 0 ? '' : `${days}:`
    const hoursString = removeZeroes && hours === 0 ? '' : `${(hours % 24).toString().padStart(2, '0')}:`
    const minutesString = removeZeroes && minutes === 0 ? '' : `${(minutes % 60).toString().padStart(2, '0')}:`
    const secondsString = `${(seconds % 60).toString().padStart(2, '0')}.${(ms % 1000).toString().padStart(3, '0')}`
    return sign + daysString + hoursString + minutesString + secondsString
  }
}
