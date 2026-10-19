import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import { Summary } from '../project/Summary'

self.onmessage = async (e) => {
  if (self.failed) return
  console.debug('Writer got message ' + e.data.type)

  try {
    switch (e.data.type) {
      case 'init':
        const input = e.data.input
        const fileHandle = await FileSystemUtils.getFileHandle(input.dirname, input.clip.filename)
        const summaryFileHandle = await FileSystemUtils.getFileHandle(input.dirname, `${input.clip.filename}_summary`)
        self.fileSyncHandle = await fileHandle.createSyncAccessHandle()
        self.summary = new Summary(input.channelCount)
        Object.keys(input.clip.summary).forEach((key) => (self.summary[key] = input.clip.summary[key]))
        self.summary.setSyncFileHandle(await summaryFileHandle.createSyncAccessHandle())
        self.position = 0
        postMessage({ type: 'ready' })
        break
      case 'audio':
        self.fileSyncHandle.write(e.data.audio, { at: self.position })
        const float32 = new Float32Array(e.data.audio)
        self.summary.summarizeInterleavedData(float32, float32.length)
        self.position += e.data.audio.byteLength
        break
      case 'stop':
        await self.fileSyncHandle?.close()
        self.summary?.finishSummarizing()
        postMessage({ type: 'finish' })
        break
    }
  } catch (error) {
    self.failed = true
    postMessage({ type: 'error', error: error instanceof Error ? error.message : String(error) })
  }
}

self.onerror = (e) => {
  console.error(e)
}

self.onmessageerror = (e) => {
  console.error(e)
}
