import { OpusFileWriter } from './OpusFileWriter'
import { expect, test } from 'vitest'
import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import { OpusApplication, OpusBandwidth, OpusBitrateMode } from './EncoderType'
// export type OpusEncoderInfo = {
//   encoder: 'opus'
//   sampleRate: number
//   channelCount: number
//   bitrate: number
//   bitrateMode: OpusBitrateMode
//   complexity: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10
//   bandwidth: OpusBandwidth
//   application: OpusApplication
//   frameSize: 2.5 | 5 | 10 | 20 | 40 | 60
// }
test('basic test', async () => {
  const fileHandle = await (await FileSystemUtils.getFileHandle('.', 'basic.opus')).createSyncAccessHandle()

  const encoderInfo = {
    encoder: 'opus',
    sampleRate: 48000,
    channelCount: 1,
    bitrate: 64000,
    bitrateMode: OpusBitrateMode.VARIABLE,
    complexity: 5,
    bandwidth: OpusBandwidth.FULLBAND,
    application: OpusApplication.OPUS_APPLICATION_AUDIO,
    frameSize: 40,
  }

  const opusFileWriter = await OpusFileWriter.create(await fileHandle.createWritable(), encoderInfo)
  const inputBuffer = opusFileWriter.getInputBuffer()
  for (let n = 0; n < 10; ++n) {
    fillBuffer(inputBuffer, n)
    await opusFileWriter.writeChunk(inputBuffer.length)
  }
  await opusFileWriter.finish()
})

test('stereo test', async () => {
  const fileHandle = await (await FileSystemUtils.getFileHandle('.', 'stereo.opus')).createSyncAccessHandle()

  const encoderInfo = {
    encoder: 'opus',
    sampleRate: 48000,
    channelCount: 2,
    bitrate: 64000,
    bitrateMode: OpusBitrateMode.VARIABLE,
    complexity: 5,
    bandwidth: OpusBandwidth.FULLBAND,
    application: OpusApplication.OPUS_APPLICATION_AUDIO,
    frameSize: 40,
  }

  const opusFileWriter = await OpusFileWriter.create(await fileHandle.createWritable(), encoderInfo)
  const inputBuffer = opusFileWriter.getInputBuffer()
  for (let n = 0; n < 10; ++n) {
    for (let i = 0; i < inputBuffer.length / 2; ++i) {
      const angle1 = (440 * (i + (n * inputBuffer.length) / 2) * (Math.PI * 2)) / 48000
      inputBuffer[2 * i] = Math.sin(angle1) * 0.8
      const angle2 = (440 * (i + ((n + 1) * inputBuffer.length) / 2) * (Math.PI * 2)) / 48000
      inputBuffer[2 * i + 1] = Math.sin(angle2) * 0.8
    }
    await opusFileWriter.writeChunk(inputBuffer.length / 2)
  }
  await opusFileWriter.finish()
})

function fillBuffer(inputBuffer, n) {
  for (let i = 0; i < inputBuffer.length; ++i) {
    const angle = (440 * (i + n * inputBuffer.length) * (Math.PI * 2)) / 48000
    inputBuffer[i] = Math.sin(angle) * 0.8
  }
}
