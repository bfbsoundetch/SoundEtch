export class Logger {
  private static readonly logItems = Array<LogItem>()
  private static callback: (_: LogItem) => any = () => {}

  constructor(private readonly tag: string) {}

  static setCallback(callback: (_: LogItem) => any) {
    Logger.callback = callback
  }

  static getLogItems(): Array<LogItem> {
    return Logger.logItems.slice()
  }

  static getLogText(): string {
    return Logger.logItems.map((item) => item.toString()).join('\n')
  }

  /** The most recent whole log lines whose joined UTF-8 text fits in `maxBytes`. */
  static getRecentLogText(maxBytes: number): string {
    const encoder = new TextEncoder()
    const lines: string[] = []
    let bytes = 0
    for (let i = Logger.logItems.length - 1; i >= 0; i--) {
      const line = Logger.logItems[i].toString()
      bytes += encoder.encode(line).byteLength + (lines.length ? 1 : 0)
      if (bytes > maxBytes) break
      lines.push(line)
    }
    return lines.reverse().join('\n')
  }

  debug(text: string, tag: string | null = null) {
    this.logAtLevel(text, Level.DEBUG)
  }

  log(text: string, tag: string | null = null) {
    this.logAtLevel(text, Level.INFO)
  }

  error(e: Error, tag: string | null = null) {
    const item = new LogItem(new Date(), this.tag, e.message, Level.ERROR)
    console.error(e)
    Logger.callback(item)
  }

  errorMessage(text: string, tag: string | null = null) {
    this.logAtLevel(text, Level.ERROR)
  }

  logAtLevel(text: string, level: Level) {
    const item = new LogItem(new Date(), this.tag, text, level)
    Logger.logItems.push(item)
    if (level < Level.WARN) {
      console.log(item.toString())
    } else {
      console.error(item.toString())
    }
    Logger.callback(item)
  }
}

export enum Level {
  DEBUG,
  INFO,
  WARN,
  ERROR,
}

export class LogItem {
  constructor(
    readonly datetime: Date,
    readonly tag: string | null,
    readonly text: string,
    readonly level: Level,
  ) {}

  toString(): string {
    return `${this.datetime.toLocaleTimeString()} ${this.tag ? '(' + this.tag + ')' : ''}: ${this.text}`
  }
}
