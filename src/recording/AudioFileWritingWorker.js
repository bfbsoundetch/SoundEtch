import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import { Summary } from '../project/Summary'

self.onmessage = async (e) => {
  console.debug('Writer got message ' + e.data.type)

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
      break
    case 'audio':
      self.fileSyncHandle.write(e.data.audio, { at: self.position })
      const float32 = new Float32Array(e.data.audio)
      self.summary.summarizeInterleavedData(float32, float32.length)
      self.position += e.data.audio.byteLength
    case 'stop':
      postMessage({type:'finish'})
      break
  }
}

self.onerror = (e) => {
  console.error(e)
}

self.onmessageerror = (e) => {
  console.error(e)
}
