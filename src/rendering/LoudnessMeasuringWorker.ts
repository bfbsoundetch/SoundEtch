import { IntegratedLoudnessMeter } from '../analyzers/IntegratedLoudnessMeter'
import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import type { FileSystemSyncAccessHandle } from '../filesystem/FileSystemSyncAccessHandle'
import {
  LoudnessMeasuringInitMessage,
  RenderingEncodingPortMessage,
  RenderingOutputWorkerMessage,
} from './RenderingWorkerProtocol'

// Pass 1 of loudness-normalized export: stores the rendered mix in a temp file while measuring its
// integrated loudness.
self.onmessage = async (event) => {
  const message = event.data as LoudnessMeasuringInitMessage
  if (message.type != 'init') {
    return
  }

  try {
    const fileHandle = await FileSystemUtils.getFileHandle(message.dirname, message.filename)
    const file = await (
      fileHandle as FileSystemFileHandle & { createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle> }
    ).createSyncAccessHandle()
    const meter = new IntegratedLoudnessMeter(message.sampleRate, message.channelCount)

    let position = 0
    let writtenFrames = 0
    let queue = Promise.resolve()

    message.encodingPort.onmessage = (event) => {
      const portMessage = event.data as RenderingEncodingPortMessage
      queue = queue
        .then(() => {
          if (portMessage.type == 'audio') {
            const audio = new Float32Array(portMessage.buffer, 0, portMessage.length)
            file.write(audio, { at: position })
            meter.addInterleaved(audio)
            position += audio.byteLength
            writtenFrames += portMessage.length / message.channelCount
            postMessage({ progress: writtenFrames / message.length } satisfies RenderingOutputWorkerMessage)
            return
          }

          file.close()
          postMessage({
            done: true,
            progress: 1,
            integratedLufs: meter.getIntegratedLoudness(),
          } satisfies RenderingOutputWorkerMessage)
        })
        .catch((error) => {
          console.error(error)
          postMessage({ error: error instanceof Error ? error.message : String(error) })
        })
    }
    message.encodingPort.start()
  } catch (error) {
    console.error(error)
    postMessage({ error: error instanceof Error ? error.message : String(error) })
  }
}
