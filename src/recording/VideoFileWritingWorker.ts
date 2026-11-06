import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import type { FileSystemSyncAccessHandle } from '../filesystem/FileSystemSyncAccessHandle'
import { getPlayableFragmentedMp4Length } from './FragmentedMp4'

export type VideoFileWritingRequest =
  | { readonly type: 'open'; readonly directory: string; readonly filename: string }
  | { readonly type: 'write'; readonly data: Uint8Array<ArrayBuffer>; readonly position: number }
  | { readonly type: 'close' }
  | { readonly type: 'trim'; readonly directory: string; readonly filename: string }
export type VideoFileWritingResponse =
  | { readonly type: 'done'; readonly size: number }
  | { readonly type: 'error'; readonly name: string; readonly message: string }

// Writes through a sync access handle and flushes each write: unlike createWritable(), which swaps the file in on
// close, the bytes survive a closed tab. Every request gets exactly one response, in order.
let file: FileSystemSyncAccessHandle | null = null
let queue = Promise.resolve()

self.onmessage = (event: MessageEvent<VideoFileWritingRequest>) => {
  const request = event.data
  queue = queue.then(async () => {
    try {
      postMessage({ type: 'done', size: await handle(request) } satisfies VideoFileWritingResponse)
    } catch (error) {
      postMessage({
        type: 'error',
        name: error instanceof Error ? error.name : 'Error',
        message: error instanceof Error ? error.message : String(error),
      } satisfies VideoFileWritingResponse)
    }
  })
}

async function handle(request: VideoFileWritingRequest): Promise<number> {
  switch (request.type) {
    case 'open':
      file = await openSyncAccessHandle(request.directory, request.filename)
      file.truncate(0)
      return 0
    case 'write':
      if (file!.write(request.data, { at: request.position }) != request.data.byteLength) {
        throw new DOMException('The video file could not be written in full', 'QuotaExceededError')
      }
      file!.flush()
      return file!.getSize()
    case 'close':
      try {
        file?.flush()
      } finally {
        file?.close()
        file = null
      }
      return 0
    case 'trim':
      return trim(request.directory, request.filename)
  }
}

/** Cuts an interrupted recording back to its playable prefix; returns the remaining size. */
async function trim(directory: string, filename: string): Promise<number> {
  // Creates a missing file empty, which reads like an empty one.
  const handle = await openSyncAccessHandle(directory, filename)
  try {
    const size = handle.getSize()
    const length = getPlayableFragmentedMp4Length(size, (position, length) => {
      const bytes = new Uint8Array(Math.min(length, size - position))
      handle.read(bytes, { at: position })
      return bytes
    })
    if (length < size) {
      handle.truncate(length)
      handle.flush()
    }
    return length
  } finally {
    handle.close()
  }
}

/** Throws NoModificationAllowedError while another handle, e.g. another tab's recording, holds the file. */
async function openSyncAccessHandle(directory: string, filename: string): Promise<FileSystemSyncAccessHandle> {
  const fileHandle = await FileSystemUtils.getFileHandle(directory, filename)
  return (
    fileHandle as FileSystemFileHandle & { createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle> }
  ).createSyncAccessHandle()
}
