import { RingBuffer } from 'ringbuf.js'
import { ClipViewSubset } from './AudioFileReader'
import { ProjectManager } from '../project/ProjectManager'
import { WorkerController } from '../audiocontext/WorkerController'
import { JobType } from '../audiocontext/ControllableWorkerJob'
import { AudioControl, AudioState } from '../audiocontext/AudioControl'
import { cloneWithGetters } from '../global/ObjectUtils'
import { Track } from '../project/Track'
import { scheduleGainAutomation } from '../effects/Effects'

export type SelectedRegion = {
  startSample: number
  endSample: number
  tracks: Array<Track>
}

export class Player {
  private static readingWorkerController: WorkerController | null = null

  static async playActiveProject2(loopRegion: SelectedRegion | null = null) {
    if (AudioControl.isPaused()) {
      AudioControl.unpause()
      return
    }
    const project = await ProjectManager.getActiveProject()
    if (project.getTracks().length == 0) {
      return
    }

    const startSample = loopRegion?.startSample ?? AudioControl.startPosition
    const endSample = loopRegion?.endSample ?? Math.max(...project.getTracks().map((t) => t.length))

    const audioContext = await AudioControl.createNewAudioContext(AudioState.PLAYING, startSample, endSample)
    await audioContext.audioWorklet.addModule('./assets/playingAudioWorklet.js')
    const workerController = Player.getReadingWorkerController()

    const playbackInfos = new Array<PlaybackInfo>()
    const playerNodes = new Array<AudioWorkletNode>()
    // Even though they'll all be used on the audio thread, I think this needs
    // to be shared because it's created on the main thread.
    const underrunBits = new BigUint64Array(new SharedArrayBuffer(8))
    project.getTracks().forEach((track, i) => {
      if (loopRegion && !loopRegion.tracks.find((t) => t == track)) {
        return
      }
      track.stopPlayback()
      const ringBufferArray = RingBuffer.getStorageForCapacity(32 * 1024, Float32Array)

      const playerNode = new AudioWorkletNode(audioContext, 'filePlayingProcessor', {
        processorOptions: {
          length: track.length,
          ringBufferArray: ringBufferArray,
          underrunBits: underrunBits,
          index: i,
          startPosition: startSample,
        },
        outputChannelCount: [track.getChannelCount()],
        channelCountMode: 'explicit',
      })
      const effectGainNode = audioContext.createGain()
      const gainNode = audioContext.createGain()
      gainNode.gain.value = track.getGain()
      const pannerNode = audioContext.createStereoPanner()
      pannerNode.pan.value = track.getPan()

      playerNode.connect(effectGainNode)
      effectGainNode.connect(gainNode)
      gainNode.connect(pannerNode)
      pannerNode.connect(audioContext.destination)

      const cleanup = Player.scheduleTrackEffects(
        track,
        effectGainNode.gain,
        audioContext,
        startSample,
        endSample,
        !!loopRegion,
      )

      playbackInfos.push({
        clipViews: track.clipViews.map((c) => {
          const result = cloneWithGetters(c)
          delete result.clip.summary
          delete result.fileCache
          return result
        }),
        ringBufferArray: ringBufferArray,
      })
      track.registerNewPlayback(playerNode, gainNode, pannerNode, [effectGainNode], cleanup)
      playerNodes.push(playerNode)
    })
    if (playerNodes.length == 0) {
      audioContext.close()
      return
    }
    workerController.setAudioWorkletNodes(playerNodes)
    workerController.start(JobType.PLAYER, {
      projectName: `${project.id}`,
      position: startSample,
      endSample: endSample,
      sampleRate: audioContext.sampleRate,
      loop: !!loopRegion,
      playbackInfos: playbackInfos,
    })
  }

  static getReadingWorkerController(): WorkerController {
    if (Player.readingWorkerController) {
      return Player.readingWorkerController
    }
    return (Player.readingWorkerController = new WorkerController())
  }

  private static scheduleTrackEffects(
    track: Track,
    param: GainNode['gain'],
    audioContext: AudioContext,
    startSample: number,
    endSample: number,
    loop: boolean,
  ) {
    const effects = track.getEffectRegions('gain')
    if (!loop) {
      scheduleGainAutomation(param, effects, audioContext.sampleRate, startSample, endSample, audioContext.currentTime)
      return null
    }

    const loopDurationSeconds = (endSample - startSample) / audioContext.sampleRate
    if (loopDurationSeconds <= 0) {
      scheduleGainAutomation(param, effects, audioContext.sampleRate, startSample, endSample, audioContext.currentTime)
      return null
    }

    let nextLoopStartTime = audioContext.currentTime
    const scheduleAheadSeconds = Math.max(loopDurationSeconds * 4, 5)
    const schedulePendingPasses = () => {
      let resetAutomation = nextLoopStartTime == audioContext.currentTime
      while (nextLoopStartTime < audioContext.currentTime + scheduleAheadSeconds) {
        scheduleGainAutomation(
          param,
          effects,
          audioContext.sampleRate,
          startSample,
          endSample,
          nextLoopStartTime,
          resetAutomation,
        )
        resetAutomation = false
        nextLoopStartTime += loopDurationSeconds
      }
    }

    schedulePendingPasses()
    const intervalId = window.setInterval(
      schedulePendingPasses,
      Math.max(250, Math.min(2000, loopDurationSeconds * 500)),
    )
    const stateChangeListener = () => {
      if (audioContext.state == 'closed') {
        window.clearInterval(intervalId)
        audioContext.removeEventListener('statechange', stateChangeListener)
      }
    }
    audioContext.addEventListener('statechange', stateChangeListener)
    return () => {
      window.clearInterval(intervalId)
      audioContext.removeEventListener('statechange', stateChangeListener)
    }
  }
}

interface PlaybackInfo {
  clipViews: Array<ClipViewSubset>
  ringBufferArray: SharedArrayBuffer
}
