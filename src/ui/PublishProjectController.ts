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
import { Renderer } from '../rendering/Renderer'
import { VIDEO_EXPORT_PRESETS, VideoRenderer, type VideoExportPresetName } from '../video/VideoRenderer'
import { NotificationsController } from './NotificationsController'
import type { ProcessingModalController } from './ProcessingModalController'
import type { TrackListController } from './timeline/TrackListController'
import { ProjectManager } from '../project/ProjectManager'

interface PublishProjectWindow extends Window {
  readonly trackListController: TrackListController
  readonly processingModalController?: ProcessingModalController
}

export class PublishProjectController {
  private readonly formatContainerMap = new Map<Format, HTMLDivElement>()
  private readonly mp3ModeContainerMap = new Map<Mp3Mode, HTMLDivElement>()
  private readonly formatSelect: HTMLSelectElement
  private readonly advancedSection: HTMLElement
  private readonly channelCountContainer: HTMLElement
  private readonly channelCountInputs: HTMLInputElement[]
  private readonly mp3ModeInputs: HTMLInputElement[]
  private readonly videoPresetInputs: HTMLInputElement[]
  private readonly appWindow = window as unknown as PublishProjectWindow

  constructor() {
    this.formatSelect = document.getElementById('format') as HTMLSelectElement
    this.advancedSection = document.querySelector('#publish-project-modal .export-advanced-section') as HTMLElement
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
      element.hidden = format !== newFormat
    })
    this.channelCountContainer.hidden = newFormat === Format.VIDEO
    this.advancedSection.hidden = newFormat === Format.VIDEO
  }

  handleMp3ModeSwitch(newMode: Mp3Mode) {
    this.mp3ModeContainerMap.forEach((element, mode) => {
      element.hidden = mode !== newMode
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
    document.querySelectorAll<HTMLInputElement>('#publish-project-modal input[type="range"]').forEach((slider) => {
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
        slider.setAttribute('aria-valuetext', output.value)
      }

      updateOutput()
      slider.addEventListener('input', updateOutput)
    })
  }

  async publishProject() {
    if (this.formatSelect.value === Format.VIDEO) {
      await this.publishVideoProject()
      return
    }

    const encoderInfo = this.createEncoderInfo()
    ;(document.getElementById('publish-project-modal') as HTMLDialogElement).close()
    const selectedRegion = this.appWindow.trackListController.selectedRegion
    this.appWindow.processingModalController?.show('Publishing project...', () => Renderer.cancelRender())
    try {
      await Renderer.exportProject(encoderInfo, selectedRegion, this.getLoudnessTargetLufs())
    } catch (e) {
      NotificationsController.showError(e as Error)
    } finally {
      this.appWindow.processingModalController?.hide()
    }
  }

  private async publishVideoProject() {
    const presetName = this.getSelectedVideoPreset()
    ;(document.getElementById('publish-project-modal') as HTMLDialogElement).close()
    const selectedRegion = this.appWindow.trackListController.selectedRegion
    const preset = VIDEO_EXPORT_PRESETS[presetName]
    this.appWindow.processingModalController?.show(`Publishing ${preset.label} video...`, () =>
      VideoRenderer.cancelExport(),
    )
    try {
      await VideoRenderer.exportProject(presetName, selectedRegion, this.getLoudnessTargetLufs())
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) NotificationsController.showError(e as Error)
    } finally {
      this.appWindow.processingModalController?.hide()
    }
  }

  private getLoudnessTargetLufs(): number | null {
    const value = this.getSelectValue('loudness-target')
    return value === '' ? null : Number(value)
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
