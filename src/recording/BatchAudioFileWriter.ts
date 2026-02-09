import { Summary } from '../project/Summary'
import { FileSystemUtils } from '../filesystem/FileSystemUtils'

export class BatchAudioFileWriter {
  static async writeAudioArray(dirname: string, filename: string, audioArray: Array<Float32Array>, summary: Summary) {
    const summarySyncHandle = await (
      (await FileSystemUtils.getFileHandle(dirname, `${filename}_summary`)) as any
    ).createSyncAccessHandle()
    summary.setSyncFileHandle(summarySyncHandle)

    const fileSyncHandle = await (
      (await FileSystemUtils.getFileHandle(dirname, filename)) as any
    ).createSyncAccessHandle()

    try {
      const outputBuffer = new Float32Array(32 * 1024)
      const channelCount = audioArray.length
      let i = 0
      for (; i < audioArray[0].length; ++i) {
        for (let channel = 0; channel < channelCount; ++channel) {
          const index = (i * channelCount + channel) % outputBuffer.length
          outputBuffer[index] = audioArray[channel][i]
          if (index == outputBuffer.length - 1) {
            fileSyncHandle.write(outputBuffer)
            console.debug('File is now size ' + fileSyncHandle.getSize())
          }
        }
      }
      fileSyncHandle.write(outputBuffer.slice(0, (i * channelCount) % outputBuffer.length))
      console.debug('The final size of the file is ' + fileSyncHandle.getSize())
      summary.summarizeSeparateChannelData(audioArray, audioArray[0].length)
    } finally {
      fileSyncHandle.close()
      summary.finishSummarizing()
    }
  }
}
