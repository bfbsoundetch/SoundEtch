import { encoderInforWritableStreamFactory } from '../encoders/EncoderType'
import {
  RenderingConsumerPortMessage,
  RenderingEncodingInitMessage,
  RenderingEncodingPortMessage,
} from './RenderingWorkerProtocol'

self.onmessage = async (e) => {
  const { type } = e.data as RenderingEncodingInitMessage
  if (type !== 'init') {
    return
  }

  const { file, encoderInfo, channelCount, encodingPort, length } = e.data as RenderingEncodingInitMessage
  const encoderWriter = await encoderInforWritableStreamFactory(await file.createWritable(), encoderInfo)
  const inputBuffer = encoderWriter.getInputBuffer()
  const channelLength = inputBuffer.length / channelCount
  let inputLength = 0
  let queue = Promise.resolve()

  let writtenFrames = 0
  const writeBufferedInput = async () => {
    if (inputLength === 0) {
      return
    }
    const chunkFrameCount = inputLength / channelCount
    await encoderWriter.writeChunk(chunkFrameCount)
    writtenFrames += chunkFrameCount
    postMessage({ progress: writtenFrames / length })
    inputLength = 0
  }

  const appendInterleavedAudio = async (audioBuffer: ArrayBuffer, length: number) => {
    const audio = new Float32Array(audioBuffer, 0, length)
    let offset = 0

    while (offset < audio.length) {
      const availableFrames = Math.min(
        channelLength - Math.floor(inputLength / channelCount),
        (audio.length - offset) / channelCount,
      )

      if (encoderWriter.inputSampleFormat === 'planar') {
        for (let frame = 0; frame < availableFrames; ++frame) {
          for (let channel = 0; channel < channelCount; ++channel) {
            inputBuffer[channelLength * channel + Math.floor(inputLength / channelCount) + frame] =
              audio[offset + frame * channelCount + channel]!
          }
        }
      } else {
        inputBuffer.set(audio.subarray(offset, offset + availableFrames * channelCount), inputLength)
      }

      inputLength += availableFrames * channelCount
      offset += availableFrames * channelCount

      if (inputLength === inputBuffer.length) {
        await writeBufferedInput()
      }
    }
  }

  const finishEncoding = async () => {
    await writeBufferedInput()
    await encoderWriter.finish()
    postMessage({ done: true })
  }

  encodingPort.onmessage = (portEvent) => {
    const message = portEvent.data as RenderingEncodingPortMessage
    queue = queue
      .then(async () => {
        if (message.type === 'audio') {
          await appendInterleavedAudio(message.buffer, message.length)
          encodingPort.postMessage({ type: 'consumed' } satisfies RenderingConsumerPortMessage)
          return
        }

        if (message.type === 'stop') {
          await finishEncoding()
          postMessage({ done: true, progress: 1 })
        }
      })
      .catch((error) => {
        console.error(error)
        postMessage({ error: error instanceof Error ? error.message : String(error) })
      })
  }

  encodingPort.start()
}
