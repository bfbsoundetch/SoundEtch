import type { ChunkedUploadState, CloudStorage, StoredFile, UploadChunk } from './CloudStorage'
import { CloudError, CloudUploadLostError } from './CloudStorage'
import {
  appendSession,
  deletePath,
  download,
  finishSession,
  isNotFound,
  listFolders,
  lookupFailure,
  startSession,
  upload,
  type FileMetadata,
} from './DropboxApi'

const EMPTY = new Uint8Array()
/** The content hash of no bytes: SHA-256 of an empty list of block digests. */
const EMPTY_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

interface SessionState extends ChunkedUploadState {
  readonly sessionId: string
}

/** The user's Dropbox App Folder; chunked uploads are Dropbox upload sessions. */
export class DropboxStorage implements CloudStorage {
  readonly provider = 'dropbox'
  readonly service = 'Dropbox'

  async listFolders(signal?: AbortSignal): Promise<string[]> {
    return (await listFolders(signal)).map((folder) => folder.path_display)
  }

  async readFile(path: string, signal?: AbortSignal): Promise<ReadableStream<Uint8Array> | null> {
    try {
      return (await download(path, signal)).body
    } catch (error) {
      if (isNotFound(error)) {
        return null
      }
      throw error
    }
  }

  async writeFile(path: string, bytes: Uint8Array<ArrayBuffer>, expected: StoredFile, signal?: AbortSignal) {
    verify(path, await upload(path, bytes, expected.contentHash, signal), expected)
  }

  async startChunkedUpload(_path: string, signal?: AbortSignal): Promise<SessionState> {
    return { sessionId: await startSession(EMPTY, EMPTY_HASH, signal) }
  }

  async appendChunk(_path: string, state: ChunkedUploadState, chunk: UploadChunk, signal?: AbortSignal) {
    const { sessionId } = state as SessionState
    try {
      await appendSession(sessionId, chunk.offset, chunk.bytes, chunk.contentHash, signal)
    } catch (error) {
      throwUnlessAlreadyStored(error, chunk)
    }
    return state
  }

  async finishChunkedUpload(
    path: string,
    state: ChunkedUploadState,
    chunk: UploadChunk,
    expected: StoredFile,
    signal?: AbortSignal,
  ) {
    const { sessionId } = state as SessionState
    let metadata: FileMetadata
    try {
      metadata = await finishSession(sessionId, chunk.offset, chunk.bytes, chunk.contentHash, path, signal)
    } catch (error) {
      throwUnlessAlreadyStored(error, chunk)
      // The chunk reached the session but the commit did not: commit without sending it again.
      const end = chunk.offset + chunk.bytes.length
      metadata = await finishSession(sessionId, end, EMPTY, EMPTY_HASH, path, signal).catch((retryError: unknown) => {
        throw lookupFailure(retryError) ? new CloudUploadLostError() : retryError
      })
    }
    verify(path, metadata, expected)
  }

  async abortChunkedUpload(): Promise<void> {
    // Dropbox cannot discard an upload session; unfinished sessions expire on their own.
  }

  async deleteFolder(path: string, signal?: AbortSignal): Promise<void> {
    await deletePath(path, signal)
  }
}

/**
 * Returns when `error` says the session already holds `chunk`: an earlier attempt reached Dropbox but its response was
 * lost. Otherwise rethrows it, as `CloudUploadLostError` when the session expired or diverged.
 */
function throwUnlessAlreadyStored(error: unknown, chunk: UploadChunk): void {
  const failure = lookupFailure(error)
  if (!failure) {
    throw error
  }
  if (failure.tag != 'incorrect_offset' || failure.correctOffset != chunk.offset + chunk.bytes.length) {
    throw new CloudUploadLostError()
  }
}

function verify(path: string, metadata: FileMetadata, expected: StoredFile): void {
  if (metadata.content_hash != expected.contentHash || metadata.size != expected.size) {
    throw new CloudError('Dropbox', `it stored ${path} with a different size or content hash`)
  }
}
