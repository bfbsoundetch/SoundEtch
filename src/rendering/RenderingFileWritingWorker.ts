import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import { Summary } from '../project/Summary'
import { RenderingEncodingPortMessage, RenderingFileWritingInitMessage } from './RenderingWorkerProtocol'

self.onmessage = async (event) => {
  const message = event.data as RenderingFileWritingInitMessage
  if (message.type != 'init') {
    return
  }

  try {
    const fileHandle = await FileSystemUtils.getFileHandle(message.dirname, message.clip.filename)
    const summaryFileHandle = await FileSystemUtils.getFileHandle(message.dirname, `${message.clip.filename}_summary`)
    const file = await (fileHandle as any).createSyncAccessHandle()
    const summary = new Summary(message.channelCount)
    Object.keys(message.clip.summary).forEach((key) => ((summary as any)[key] = (message.clip.summary as any)[key]))
    summary.setSyncFileHandle(await (summaryFileHandle as any).createSyncAccessHandle())

    let position = 0
    let writtenFrames = 0
    let queue = Promise.resolve()

    message.encodingPort.onmessage = (event) => {
      const portMessage = event.data as RenderingEncodingPortMessage
      queue = queue
        .then(() => {
          if (portMessage.type == 'audio') {
            const audio = portMessage.buffer.slice(0, portMessage.length * Float32Array.BYTES_PER_ELEMENT)
            file.write(audio, { at: position })
            summary.summarizeInterleavedData(new Float32Array(audio), portMessage.length)
            position += audio.byteLength
            writtenFrames += portMessage.length / message.channelCount
            postMessage({ progress: writtenFrames / message.length })
            return
          }

          file.close()
          summary.finishSummarizing()
          postMessage({ done: true, progress: 1 })
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
