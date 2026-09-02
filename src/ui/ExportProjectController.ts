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
import type { TrackListController } from './timeline/TrackListController'
import { NotificationsController } from './NotificationsController'
import { ProjectManager } from '../project/ProjectManager'
import type { VideoExportPresetName } from '../video/VideoRenderer'

export class ExportProjectController {
  private readonly formatContainerMap = new Map<Format, HTMLDivElement>()
  private readonly mp3ModeContainerMap = new Map<Mp3Mode, HTMLDivElement>()
  private readonly formatSelect: HTMLSelectElement
  private readonly advancedSection: HTMLElement
  private readonly channelCountContainer: HTMLElement
  private readonly channelCountInputs: HTMLInputElement[]
  private readonly mp3ModeInputs: HTMLInputElement[]
  private readonly videoPresetInputs: HTMLInputElement[]

  constructor() {
    this.formatSelect = document.getElementById('format') as HTMLSelectElement
    this.advancedSection = document.querySelector('#export-project-modal .export-advanced-section') as HTMLElement
    this.channelCountContainer = document.getElementById('channel-count-container') as HTMLElement
    this.channelCountInputs = Array.from(document.querySelectorAll('input[name="channel-count"]')) as HTMLInputElement[]
    this.mp3ModeInputs = Array.from(document.querySelectorAll('input[name="mp3-mode"]')) as HTMLInputElement[]
    this.videoPresetInputs = Array.from(document.querySelectorAll('input[name="video-preset"]')) as HTMLInputElement[]

    this.formatContainerMap.set(Format.WAV, document.getElementById('wav-options-container') as HTMLDivElement)
    this.formatContainerMap.set(Format.FLAC, document.getElementById('flac-options-container') as HTMLDivElement)
    this.formatContainerMap.set(Format.MP3, document.getElementById('mp3-options-container') as HTMLDivElement)
    this.formatContainerMap.set(Format.OPUS, document.getElementById('opus-options-container') as HTMLDivElement)
    this.formatContainerMap.set(Format.VIDEO, document.getElementById('video-options-container') as HTMLDivElement)

    this.mp3ModeContainerMap.set(Mp3Mode.CBR, document.getElementById('mp3-cbr-options') as HTMLDivElement)
    this.mp3ModeContainerMap.set(Mp3Mode.VBR, document.getElementById('mp3-vbr-options') as HTMLDivElement)

    this.mp3ModeInputs.forEach((input) => {
      input.addEventListener('change', () => {
        this.handleMp3ModeSwitch(input.value as Mp3Mode)
      })
    })

    this.initializeSliderOutputs()

    this.handleFormatSwitch(this.formatSelect.value as Format)
    this.handleMp3ModeSwitch(this.getSelectedMp3Mode())
    void ProjectManager.addProjectListener((project) => {
      const channelCount = project.getTracks().some((track) => track.getChannelCount() === 2) ? '2' : '1'
      this.channelCountInputs.forEach((input) => {
        input.checked = input.value === channelCount
      })
    })
  }

  handleFormatSwitch(newFormat: Format) {
    this.formatContainerMap.forEach((element, format) => {
      element.style.display = format === newFormat ? 'flex' : 'none'
    })
    this.channelCountContainer.style.display = newFormat === Format.VIDEO ? 'none' : 'flex'
    this.advancedSection.style.display = newFormat === Format.VIDEO ? 'none' : 'flex'
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

  private getSelectedChannelCount(): number {
    return Number(this.channelCountInputs.find((input) => input.checked)?.value ?? 1)
  }

  private getSelectedVideoPreset(): VideoExportPresetName {
    return (
      (this.videoPresetInputs.find((input) => input.checked)?.value as VideoExportPresetName | undefined) ?? 'youtube'
    )
  }

  private initializeSliderOutputs() {
    document.querySelectorAll<HTMLInputElement>('#export-project-modal input[type="range"]').forEach((slider) => {
      const output = slider.nextElementSibling?.querySelector('output')
      if (!(output instanceof HTMLOutputElement)) {
        return
      }

      const updateOutput = () => {
        const min = Number(slider.min)
        const max = Number(slider.max)
        const percentage = ((slider.valueAsNumber - min) / (max - min)) * 100
        output.style.left = `calc(${percentage}% + (${9 - percentage * 0.18}px))`
        output.value = `${slider.value}${slider.dataset.outputSuffix ?? ''}`
      }

      updateOutput()
      slider.addEventListener('input', updateOutput)
      slider.addEventListener('mouseenter', () => {
        output.style.opacity = '1'
      })
      slider.addEventListener('mouseleave', () => {
        output.style.opacity = '0'
      })
    })
  }

  async exportProject() {
    if (this.formatSelect.value === Format.VIDEO) {
      await this.exportVideoProject()
      return
    }

    // Rendering is loaded only after export starts, keeping it out of the initial timeline chunk.
    const { Renderer } = await import('../rendering/Renderer')

    const encoderInfo = this.createEncoderInfo()
    ;(document.getElementById('export-project-modal') as HTMLDialogElement).close()
    const selectedRegion = ((window as any).trackListController as TrackListController).selectedRegion
    ;(window as any).processingModalController?.show('Exporting project...', () => Renderer.cancelRender())
    try {
      await Renderer.exportProject(encoderInfo, selectedRegion)
    } catch (e) {
      NotificationsController.showError(e as Error)
    } finally {
      ;(window as any).processingModalController?.hide()
    }
  }

  private async exportVideoProject() {
    // Video encoding is the largest dependency path and is needed only for video export.
    const { VIDEO_EXPORT_PRESETS, VideoRenderer } = await import('../video/VideoRenderer')
    const presetName = this.getSelectedVideoPreset()
    ;(document.getElementById('export-project-modal') as HTMLDialogElement).close()
    const selectedRegion = ((window as any).trackListController as TrackListController).selectedRegion
    const preset = VIDEO_EXPORT_PRESETS[presetName]
    ;(window as any).processingModalController?.show(`Exporting ${preset.label} video...`, () =>
      VideoRenderer.cancelExport(),
    )
    try {
      await VideoRenderer.exportProject(presetName, selectedRegion)
    } catch (e) {
      NotificationsController.showError(e as Error)
    } finally {
      ;(window as any).processingModalController?.hide()
    }
  }

  private createEncoderInfo(): EncoderInfo {
    const channelCount = this.getSelectedChannelCount()
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
  VIDEO = 'video',
}

enum Mp3Mode {
  CBR = 'cbr',
  VBR = 'vbr',
}
