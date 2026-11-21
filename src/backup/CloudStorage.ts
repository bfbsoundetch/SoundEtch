/** The cloud services that can hold backups. */
export type CloudProviderId = 'dropbox' | 's3'

/** Bytes of a file at `offset`, with their `contentHash`. */
export interface UploadChunk {
  readonly offset: number
  readonly bytes: Uint8Array<ArrayBuffer>
  readonly contentHash: string
}

/** What a finished upload must have stored. */
export interface StoredFile {
  readonly size: number
  readonly contentHash: string
}

/** A chunked upload's provider-specific progress. Structured-cloneable, so it is persisted between chunks. */
export type ChunkedUploadState = Readonly<Record<string, unknown>>

export interface UploadLink {
  readonly method: 'POST' | 'PUT'
  readonly url: string
  /** Takes one upload (Dropbox); otherwise any number until it expires (S3). */
  readonly singleUse: boolean
}

export interface CloudFile {
  readonly name: string
  readonly size: number
  /** The `ContentHasher` digest, when the provider reports one. */
  readonly contentHash: string | null
}

/**
 * Files in one cloud account or bucket, addressed by `/`-separated paths that start with `/`. Requests retry transient
 * failures themselves and fail with the `Cloud*Error` classes below, so callers handle every provider alike.
 */
export interface CloudStorage {
  readonly provider: CloudProviderId
  /** The service's name in messages, e.g. "Dropbox". */
  readonly service: string
  /** The folders at the root, as `/name` paths. */
  listFolders(signal?: AbortSignal): Promise<string[]>
  /** The bytes of the file at `path`, or null when there is none. */
  readFile(path: string, signal?: AbortSignal): Promise<ReadableStream<Uint8Array> | null>
  /** Stores `bytes`, which `expected` describes, at `path` in one request. */
  writeFile(path: string, bytes: Uint8Array<ArrayBuffer>, expected: StoredFile, signal?: AbortSignal): Promise<void>
  /** Begins an upload of `path` too large for one request. */
  startChunkedUpload(path: string, signal?: AbortSignal): Promise<ChunkedUploadState>
  /**
   * Stores `chunk`, which is not the last, and returns the upload's new state. Sending a chunk again after its response
   * was lost is safe. Fails with `CloudUploadLostError` when the upload must start over.
   */
  appendChunk(
    path: string,
    state: ChunkedUploadState,
    chunk: UploadChunk,
    signal?: AbortSignal,
  ): Promise<ChunkedUploadState>
  /** Stores the last chunk, possibly empty, and commits the file, which `expected` describes. */
  finishChunkedUpload(
    path: string,
    state: ChunkedUploadState,
    chunk: UploadChunk,
    expected: StoredFile,
    signal?: AbortSignal,
  ): Promise<void>
  /** Discards an unfinished upload's stored chunks; an upload that no longer exists counts as discarded. */
  abortChunkedUpload(path: string, state: ChunkedUploadState, signal?: AbortSignal): Promise<void>
  /** Deletes the folder and everything in it; a missing folder counts as deleted. */
  deleteFolder(path: string, signal?: AbortSignal): Promise<void>
  /** A URL that uploads the file at `path` without credentials, valid for up to `seconds`. */
  createUploadLink(path: string, seconds: number, signal?: AbortSignal): Promise<UploadLink>
  /** The files directly in `folder`, or null when it holds none or does not exist. */
  listFiles(folder: string, signal?: AbortSignal): Promise<CloudFile[] | null>
}

/** The service rejected a request; `reason` is its readable explanation. */
export class CloudError extends Error {
  override name = 'CloudError'

  constructor(
    readonly service: string,
    readonly reason: string,
  ) {
    super(`${service} rejected the request (${reason})`)
  }
}

/** The service refused the stored credentials; the message says what the user must do. */
export class CloudAuthorizationError extends Error {
  override name = 'CloudAuthorizationError'
}

export class CloudUnavailableError extends Error {
  override name = 'CloudUnavailableError'

  constructor(service: string) {
    super(`${service} could not be reached.`)
  }
}

/** The account or bucket has no room; the message names it. */
export class CloudStorageFullError extends Error {
  override name = 'CloudStorageFullError'
}

/** A chunked upload expired or diverged and must start over. */
export class CloudUploadLostError extends Error {
  override name = 'CloudUploadLostError'

  constructor() {
    super('The upload expired and must start over.')
  }
}

export const MAX_REQUEST_ATTEMPTS = 6

/**
 * Waits before attempt `attempt + 1`: the server's requested delay, or 1, 2, 4, 8, then 16 seconds. Fails with
 * `CloudUnavailableError` after the last attempt.
 */
export async function waitBeforeRetry(
  service: string,
  attempt: number,
  retryAfterSeconds: number | null,
  signal?: AbortSignal,
): Promise<void> {
  if (attempt >= MAX_REQUEST_ATTEMPTS) {
    throw new CloudUnavailableError(service)
  }
  const milliseconds = (retryAfterSeconds ?? 2 ** (attempt - 1)) * 1000
  signal?.throwIfAborted()
  const { promise, resolve, reject } = Promise.withResolvers<void>()
  const onAbort = () => {
    clearTimeout(timer)
    reject(signal!.reason)
  }
  const timer = setTimeout(() => {
    signal?.removeEventListener('abort', onAbort)
    resolve()
  }, milliseconds)
  signal?.addEventListener('abort', onAbort, { once: true })
  await promise
}

/** The `Retry-After` header in seconds, when it holds one. */
export function retryAfterHeaderSeconds(response: Response): number | null {
  const header = Number(response.headers.get('Retry-After'))
  return response.headers.has('Retry-After') && Number.isFinite(header) && header >= 0 ? header : null
}
