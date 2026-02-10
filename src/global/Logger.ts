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

  log(text: string, tag: string | null = null) {
    this.logAtLevel(text, Level.INFO)
  }

  debug(text: string, tag: string | null = null) {
    this.logAtLevel(text, Level.DEBUG)
  }

  error(text: string, tag: string | null = null) {
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
