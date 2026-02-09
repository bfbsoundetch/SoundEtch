import { FlacFileWriter } from './FlacFileWriter'
import { expect, test } from 'vitest'
import { FileSystemUtils } from '../filesystem/FileSystemUtils'
// export type FlacEncoderInfo = {
//   encoder: 'flac'
//   sampleRate: number
//   channelCount: number
//   bitDepth: 8 | 12 | 16 | 20 | 24
//   compressionLevel: number
// }
test('basic test', async () => {
  const fileHandle = await (await FileSystemUtils.getFileHandle('.', 'basic.flac')).createSyncAccessHandle()

  const encoderInfo = {
    encoder: 'flac',
    sampleRate: 48000,
    channelCount: 1,
    bitDepth: 8,
    compressionLevel: 8,
  }

  const flacFileWriter = await FlacFileWriter.create(await fileHandle.createWritable(), encoderInfo)
  const inputBuffer = flacFileWriter.getInputBuffer()
  for (let n = 0; n < 10; ++n) {
    fillBuffer(inputBuffer, n)
    await flacFileWriter.writeChunk(inputBuffer.length)
  }
  await flacFileWriter.finish()
})

test('stereo test', async () => {
  const fileHandle = await (await FileSystemUtils.getFileHandle('.', 'stereo.flac')).createSyncAccessHandle()

  const encoderInfo = {
    encoder: 'flac',
    sampleRate: 48000,
    channelCount: 2,
    bitDepth: 24,
    compressionLevel: 5,
  }

  const flacFileWriter = await FlacFileWriter.create(await fileHandle.createWritable(), encoderInfo)
  const inputBuffer = flacFileWriter.getInputBuffer()
  for (let n = 0; n < 10; ++n) {
    fillBuffer(inputBuffer.subarray(0, inputBuffer.length / 2), n)
    fillBuffer(inputBuffer.subarray(inputBuffer.length / 2), n + 1)
    await flacFileWriter.writeChunk(inputBuffer.length / 2)
  }
  await flacFileWriter.finish()
})

function fillBuffer(inputBuffer, n) {
  for (let i = 0; i < inputBuffer.length; ++i) {
    const angle = (440 * (i + n * inputBuffer.length) * (Math.PI * 2)) / 48000
    inputBuffer[i] = Math.sin(angle) * 0.8
  }
}
