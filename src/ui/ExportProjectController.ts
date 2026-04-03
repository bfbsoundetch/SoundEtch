import { Renderer } from '../rendering/Renderer'
import {
  EncoderInfo,
  FlacEncoderInfo,
  Mp3CbrValue,
  Mp3EncoderInfo,
  Mp3OutputSampleRate,
  OpusApplication,
  OpusBandwidth,
  OpusBitrateMode,
  OpusEncoderInfo,
  WavEncoderInfo,
  WavSampleFormat,
} from '../encoders/EncoderType'

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
    const percentage = vbrSlider.valueAsNumber / 0.09
    vbrOutput.style.left = `calc(${percentage}% + (${9 - percentage * 0.15}px))`
    vbrSlider.oninput = () => {
      const percentage = vbrSlider.valueAsNumber / 0.09
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

  async exportProject() {
    const encoderInfo = this.createEncoderInfo()
    ;(document.getElementById('export-project-modal') as HTMLDialogElement).close()
    await Renderer.exportProject(encoderInfo)
  }

  private createEncoderInfo(): EncoderInfo {
    const channelCount = 1
    switch (this.formatSelect.value as Format) {
      case Format.WAV:
        return {
          encoder: 'wav',
          sampleRate: this.getNumberValue('wav-sample-rate'),
          channelCount,
          sampleFormat: this.getSelectValue('wav-sample-format') as WavSampleFormat,
          sampleCount: 0,
        } as WavEncoderInfo
      case Format.FLAC:
        return {
          encoder: 'flac',
          sampleRate: this.getNumberValue('flac-sample-rate'),
          channelCount,
          bitDepth: this.getNumberValue('flac-bit-depth') as FlacEncoderInfo['bitDepth'],
          compressionLevel: this.getNumberValue('flac-compression') as FlacEncoderInfo['compressionLevel'],
        }
      case Format.OPUS:
        return {
          encoder: 'opus',
          sampleRate: 48000,
          channelCount,
          bitrate: this.getNumberValue('opus-bitrate'),
          bitrateMode: this.getNumberValue('opus-bitrate-mode') as OpusBitrateMode,
          complexity: this.getNumberValue('opus-complexity') as OpusEncoderInfo['complexity'],
          bandwidth: this.getNumberValue('opus-bandwidth') as OpusBandwidth,
          application: this.getNumberValue('opus-application') as OpusApplication,
          frameSize: this.getNumberValue('opus-frame-size') as OpusEncoderInfo['frameSize'],
        }
      case Format.MP3:
      default:
        const mode = this.getSelectedMp3Mode()
        return {
          encoder: 'mp3',
          sampleRate: this.getNumberValue('mp3-sample-rate') as Mp3OutputSampleRate,
          channelCount,
          bitrate: mode === Mp3Mode.CBR ? (this.getNumberValue('mp3-cbr-bitrate') as Mp3CbrValue) : undefined,
          vbrQuality: mode === Mp3Mode.VBR ? this.getNumberValue('vbr-quality-slider') : undefined,
        } as Mp3EncoderInfo
    }
  }

  private getSelectValue(id: string): string {
    return (document.getElementById(id) as HTMLSelectElement).value
  }

  private getNumberValue(id: string): number {
    return Number((document.getElementById(id) as HTMLInputElement | HTMLSelectElement).value)
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
