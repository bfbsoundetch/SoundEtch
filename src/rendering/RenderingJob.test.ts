import { expect, onTestFinished, test, vi } from 'vitest'
import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import type { FileSystemSyncAccessHandle } from '../filesystem/FileSystemSyncAccessHandle'
import { AudioFileCache } from '../playback/AudioFileCache'
import type { RenderingEncodingPortMessage, RenderingWorkerStartMessage, TrackSubset } from './RenderingWorkerProtocol'

/** Model OPFS locks: read-only handles share a file, but a default read/write handle excludes every other handle. */
function sourceFile(level: number): FileSystemFileHandle {
  const bytes = new Uint8Array(new Float32Array(4096).fill(level).buffer)
  const readers = new Set<{ readOnly: boolean }>()
  const denyWrite = () => {
    throw new DOMException('Source is read-only', 'NoModificationAllowedError')
  }
  // The renderer only needs the sync API from this file-handle fixture.
  const file = {
    async createSyncAccessHandle(options?: { mode?: string }): Promise<FileSystemSyncAccessHandle> {
      const reader = { readOnly: options?.mode === 'read-only' }
      if ([...readers].some((open) => !open.readOnly) || (!reader.readOnly && readers.size > 0)) {
        throw new DOMException('Source file is already locked', 'NoModificationAllowedError')
      }
      readers.add(reader)
      return {
        read(buffer, { at = 0 } = { at: 0 }) {
          const destination = ArrayBuffer.isView(buffer)
            ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
            : new Uint8Array(buffer)
          const source = bytes.subarray(at, at + destination.byteLength)
          destination.set(source)
          return source.byteLength
        },
        write: denyWrite,
        truncate: denyWrite,
        flush: denyWrite,
        getSize: () => bytes.byteLength,
        close: () => {
          readers.delete(reader)
        },
      }
    },
  } as unknown as FileSystemFileHandle
  return file
}

test('publishing mixes shared clips and crossfades while playback holds a source reader', async () => {
  const scope: { onmessage: ((event: MessageEvent<RenderingWorkerStartMessage>) => Promise<void>) | null } = {
    onmessage: null,
  }
  vi.stubGlobal('self', scope)
  onTestFinished(async () => {
    await AudioFileCache.cleanUp()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })
  const files: Record<string, FileSystemFileHandle> = {
    '1': sourceFile(0.125),
    '2': sourceFile(0.25),
  }
  vi.spyOn(FileSystemUtils, 'getFileHandle').mockImplementation(async (_directory, name) => {
    const file = files[name]
    if (!file) throw new Error(`Unexpected source ${name}`)
    return file
  })
  await AudioFileCache.getHandle('1', '1')
  // Loading this worker installs self.onmessage, so its global scope must exist before the module executes.
  await import('./RenderingJob')

  const track: TrackSubset = {
    name: 'crossfade',
    length: 4096,
    channelCount: 1,
    gain: 1,
    pan: 0,
    effects: [],
    clipViews: [
      { startPosition: 0, offset: 0, length: 3072, clip: { id: 1, channelCount: 1 } },
      { startPosition: 2048, offset: 0, length: 2048, clip: { id: 2, channelCount: 1 } },
    ],
  }
  const messages: RenderingEncodingPortMessage[] = []
  // Only the worker's output side of the port is needed; render and mixing remain real.
  const port = {
    postMessage: (message: RenderingEncodingPortMessage) => messages.push(message),
  } as unknown as MessagePort
  await scope.onmessage!(
    new MessageEvent('message', {
      data: {
        argument: {
          projectId: 1,
          sampleRate: 48000,
          channelCount: 1,
          startPosition: 0,
          length: 4096,
          outputEffects: [],
          trackSubsets: [
            track,
            {
              ...track,
              name: 'shared source',
              clipViews: [{ startPosition: 0, offset: 0, length: 4096, clip: { id: 1, channelCount: 1 } }],
            },
          ],
        },
        encodingPort: port,
      },
    }),
  )

  const samples = messages.flatMap((message) =>
    message.type === 'audio' ? Array.from(new Float32Array(message.buffer, 0, message.length)) : [],
  )
  expect(messages.at(-1)).toEqual({ type: 'stop' })
  expect(samples).toHaveLength(4096)
  for (let frame = 0; frame < samples.length; ++frame) {
    const expected =
      frame < 2048
        ? 0.25
        : frame >= 3072
          ? 0.375
          : 0.125 +
            0.125 * Math.cos((((frame - 2048) / 1024) * Math.PI) / 2) +
            0.25 * Math.sin((((frame - 2048) / 1024) * Math.PI) / 2)
    expect(samples[frame]).toBeCloseTo(expected, 6)
  }
})
