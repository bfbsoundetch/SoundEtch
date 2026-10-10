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

  static toString(ms: number, removeZeroes: boolean, roundSeconds = false): string {
    const sign = ms < 0 ? '-' : ''
    ms = Math.abs(ms)
    const days = TimeUtils.toDays(ms)
    const hours = TimeUtils.toHours(ms)
    const minutes = TimeUtils.toMinutes(ms)
    const seconds = TimeUtils.toSeconds(ms)
    const daysString = days === 0 ? '' : `${days}:`
    const hoursString = removeZeroes && hours === 0 ? '' : `${(hours % 24).toString().padStart(2, '0')}:`
    const minutesString = removeZeroes && minutes === 0 ? '' : `${(minutes % 60).toString().padStart(2, '0')}:`
    let secondsString = `${(seconds % 60).toString().padStart(2, '0')}`
    if (!roundSeconds) {
      secondsString += `.${(ms % 1000).toString().padStart(3, '0')}`
    }
    return sign + daysString + hoursString + minutesString + secondsString
  }

  /** Converts milliseconds to words for assistive technology, e.g. "1 minute 1.25 seconds". */
  static toSpokenString(ms: number): string {
    const total = Math.max(0, Math.round(ms))
    const hours = Math.floor(total / 3_600_000)
    const minutes = Math.floor((total % 3_600_000) / 60_000)
    const seconds = (total % 60_000) / 1000
    const parts: string[] = []
    if (hours > 0) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`)
    if (minutes > 0) parts.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`)
    if (seconds > 0 || parts.length === 0) {
      parts.push(`${String(Number(seconds.toFixed(3)))} ${seconds === 1 ? 'second' : 'seconds'}`)
    }
    return parts.join(' ')
  }
}
