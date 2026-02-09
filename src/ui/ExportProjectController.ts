export class ExportProjectController {
  private readonly formatContainerMap = new Map<Format, HTMLDivElement>()

  constructor() {
    this.formatContainerMap.set(Format.WAV, document.getElementById('wav-options-container') as HTMLDivElement)
    this.formatContainerMap.set(Format.FLAC, document.getElementById('flac-options-container') as HTMLDivElement)
    this.formatContainerMap.set(Format.MP3, document.getElementById('mp3-options-container') as HTMLDivElement)
    this.formatContainerMap.set(Format.OPUS, document.getElementById('opus-options-container') as HTMLDivElement)
  }

  handleFormatSwitch(newFormat: Format) {
    this.formatContainerMap.forEach((element, format) => {
      if (format === newFormat) {
        element.style.display = 'flex'
      } else {
        element.style.display = 'none'
      }
    })
  }
}

enum Format {
  WAV = 'wav',
  FLAC = 'flac',
  MP3 = 'mp3',
  OPUS = 'opus',
}
