import { RingBuffer } from 'ringbuf.js'
import { ClipViewSubset } from './AudioFileReader'
import { ProjectManager } from '../project/ProjectManager'
import { WorkerController } from '../audiocontext/WorkerController'
import { JobType } from '../audiocontext/ControllableWorkerJob'
import { AudioControl, AudioState } from '../audiocontext/AudioControl'
import { cloneWithGetters } from '../global/ObjectUtils'
import { Track } from '../project/Track'
import { EffectIndex } from '../effects/EffectIndex'
import { ParameterValueSequence, ParamValueTransition } from '../effects/ParameterValueSequence'

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
    for (const [i, track] of project.getTracks().entries()) {
      if (loopRegion && !loopRegion.tracks.find((t) => t == track)) {
        continue
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
      const gainNode = audioContext.createGain()
      gainNode.gain.value = track.getGain()
      const pannerNode = audioContext.createStereoPanner()
      pannerNode.pan.value = track.getPan()

      const playbackEffects = []
      let chainOutput: AudioNode = playerNode
      for (const effectData of track.effectRegions) {
        const effectModule = await EffectIndex.getInstance().getEffectById(effectData.id)
        if (!effectModule) {
          console.error(`Effect ${effectData.id} is unavailable`)
          continue
        }
        const effectNode = await effectModule.getNode(audioContext)
        const parameters = await effectModule.getParameters(audioContext)
        for (const [name, sequence] of Object.entries(effectData.params)) {
          const parameter = parameters[name]
          if (parameter) {
            scheduleParameterValues(parameter, sequence, audioContext, startSample)
          }
        }
        chainOutput.connect(effectNode)
        chainOutput = effectNode
        playbackEffects.push({ instanceId: effectData.instanceId, module: effectModule, node: effectNode })
      }

      chainOutput.connect(gainNode)
      gainNode.connect(pannerNode)
      pannerNode.connect(audioContext.destination)

      playbackInfos.push({
        clipViews: track.clipViews.map((c) => {
          const result = cloneWithGetters(c)
          delete result.clip.summary
          delete result.fileCache
          return result
        }),
        ringBufferArray: ringBufferArray,
      })
      track.registerNewPlayback(playerNode, gainNode, pannerNode, playbackEffects, () => {})
      playerNodes.push(playerNode)
    }
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
}

export function scheduleParameterValues(
  parameter: AudioParam,
  sequence: ParameterValueSequence,
  audioContext: BaseAudioContext,
  startSample: number,
) {
  const transitions = [...sequence.transitionSequence].sort((a, b) => a.startSample - b.startSample)
  const elapsedTransitions = transitions.filter((transition) => transition.startSample <= startSample)
  let previousValue = elapsedTransitions.at(-1)?.startValue ?? sequence.initialValue
  let previousSample = startSample

  parameter.cancelScheduledValues(audioContext.currentTime)
  parameter.setValueAtTime(previousValue, audioContext.currentTime)

  for (const transition of transitions) {
    if (transition.startSample <= startSample) {
      continue
    }
    const time = audioContext.currentTime + (transition.startSample - startSample) / audioContext.sampleRate
    const previousTime = audioContext.currentTime + (previousSample - startSample) / audioContext.sampleRate
    scheduleTransition(parameter, transition, previousValue, previousTime, time)
    previousValue = transition.startValue
    previousSample = transition.startSample
  }
}

function scheduleTransition(
  parameter: AudioParam,
  transition: ParamValueTransition,
  previousValue: number,
  previousTime: number,
  time: number,
) {
  if (transition.type == 'linear') {
    parameter.linearRampToValueAtTime(transition.startValue, time)
    return
  }
  if (transition.type == 'exponential' && previousValue > 0 && transition.startValue > 0) {
    parameter.exponentialRampToValueAtTime(transition.startValue, time)
    return
  }

  const duration = time - previousTime
  if (duration <= 0) {
    parameter.setValueAtTime(transition.startValue, time)
    return
  }
  const normalizedCurve =
    transition.type == 'scurve'
      ? ParamValueTransition.generateSCurve()
      : transition.type == 'logarithmic'
        ? ParamValueTransition.generateLogCurve()
        : ParamValueTransition.generateExpCurve()
  const curve = Float32Array.from(
    normalizedCurve,
    (value) => previousValue + value * (transition.startValue - previousValue),
  )
  parameter.setValueCurveAtTime(curve, previousTime, duration)
}

interface PlaybackInfo {
  clipViews: Array<ClipViewSubset>
  ringBufferArray: SharedArrayBuffer
}
