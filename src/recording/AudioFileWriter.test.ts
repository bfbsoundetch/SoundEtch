import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import { AudioFileWriter } from './AudioFileWriter'
import { RingBuffer } from 'ringbuf.js'
import { FileSystemSyncAccessHandle } from '../filesystem/FileSystemSyncAccessHandle'
import { GlobalSettings } from '../global/GlobalSettings'
import { Summary } from '../project/Summary'

GlobalSettings.useMemoryFS = true

test('write test', async () => {
  const file = await FileSystemUtils.getFileHandle('test', 'test')
  const syncFileAccessHandle: FileSystemSyncAccessHandle = await file.createSyncAccessHandle()
  const ringBufferArray = RingBuffer.getStorageForCapacity(1024, Float32Array)
  const ringBuffer = new RingBuffer(ringBufferArray, Float32Array)
  const inputBuffer = getInputArrayBuffer(1.1, 2.2, 3.3, 4.4, 5.5)
  ringBuffer.push(new Float32Array(inputBuffer))
  const audioFileWriter = new AudioFileWriter(
    syncFileAccessHandle,
    new Summary(1),
    ringBufferArray,
    new SharedArrayBuffer(4),
  )

  audioFileWriter.maybeGetChunkAndWrite()

  const outputBuffer = new ArrayBuffer(20)
  syncFileAccessHandle.read(outputBuffer)
  expect(ringBuffer.availableRead()).toBe(0)
  expect(new Uint8Array(outputBuffer)).toEqual(new Uint8Array(inputBuffer))
})

function getInputArrayBuffer(...data: Array<number>): ArrayBuffer {
  const result = new Float32Array(new ArrayBuffer(Float32Array.BYTES_PER_ELEMENT * data.length))
  for (let i = 0; i < data.length; ++i) {
    result[i] = data[i]
  }
  return result.buffer
}
