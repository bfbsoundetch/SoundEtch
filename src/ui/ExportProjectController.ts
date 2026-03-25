export class ExportProjectController {
  private readonly formatContainerMap = new Map<Format, HTMLDivElement>()
  private readonly mp3ModeContainerMap = new Map<Mp3Mode, HTMLDivElement>()
  private readonly formatSelect: HTMLSelectElement
  private readonly mp3ModeInputs: HTMLInputElement[]

  constructor() {
    this.formatSelect = document.getElementById('format') as HTMLSelectElement
    this.mp3ModeInputs = Array.from(document.querySelectorAll('input[name="mp3-mode"]')) as HTMLInputElement[]

    this.formatContainerMap.set(Format.WAV, document.getElementById('wav-options-container') as HTMLDivElement)
    this.formatContainerMap.set(Format.FLAC, document.getElementById('flac-options-container') as HTMLDivElement)
    this.formatContainerMap.set(Format.MP3, document.getElementById('mp3-options-container') as HTMLDivElement)
    this.formatContainerMap.set(Format.OPUS, document.getElementById('opus-options-container') as HTMLDivElement)

    this.mp3ModeContainerMap.set(Mp3Mode.CBR, document.getElementById('mp3-cbr-options') as HTMLDivElement)
    this.mp3ModeContainerMap.set(Mp3Mode.VBR, document.getElementById('mp3-vbr-options') as HTMLDivElement)

    this.mp3ModeInputs.forEach((input) => {
      input.addEventListener('change', () => {
        this.handleMp3ModeSwitch(input.value as Mp3Mode)
      })
    })

    const vbrSlider = document.getElementById('vbr-quality-slider') as HTMLInputElement
    const vbrOutput = document.getElementById('vbr-quality-output') as HTMLOutputElement
    const percentage = vbrSlider.valueAsNumber / .09
    vbrOutput.style.left = `calc(${percentage}% + (${9 - percentage * 0.15}px))`
    vbrSlider.oninput = () => {
      const percentage = vbrSlider.valueAsNumber / .09
      // adjust for handle width
      vbrOutput.style.left = `calc(${percentage}% + (${9 - percentage * 0.15}px))`
      vbrOutput.value = vbrSlider.value
    }
    vbrSlider.addEventListener('mouseenter', () => {
      vbrOutput.style.opacity = '1'
    })
    vbrSlider.addEventListener('mouseleave', () => {
      vbrOutput.style.opacity = '0'
    })


    this.handleFormatSwitch(this.formatSelect.value as Format)
    this.handleMp3ModeSwitch(this.getSelectedMp3Mode())
  }

  handleFormatSwitch(newFormat: Format) {
    this.formatContainerMap.forEach((element, format) => {
      element.style.display = format === newFormat ? 'flex' : 'none'
    })
  }

  handleMp3ModeSwitch(newMode: Mp3Mode) {
    this.mp3ModeContainerMap.forEach((element, mode) => {
      element.style.display = mode !== newMode ? 'none' : 'block'
    })
  }

  private getSelectedMp3Mode(): Mp3Mode {
    const selectedInput = this.mp3ModeInputs.find((input) => input.checked)
    return (selectedInput?.value as Mp3Mode | undefined) ?? Mp3Mode.CBR
  }
}

enum Format {
  WAV = 'wav',
  FLAC = 'flac',
  MP3 = 'mp3',
  OPUS = 'opus',
}

enum Mp3Mode {
  CBR = 'cbr',
  VBR = 'vbr',
}
