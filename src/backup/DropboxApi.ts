import { isObjectRecord } from '../global/TypeGuards'
import { CloudError, CloudStorageFullError, retryAfterHeaderSeconds, waitBeforeRetry } from './CloudStorage'
import { clearToken, DropboxAuthorizationError, DropboxPermissionError, getAccessToken } from './DropboxAuthorization'

const API_URL = 'https://api.dropboxapi.com/2'
const CONTENT_URL = 'https://content.dropboxapi.com/2'

export interface FileMetadata {
  readonly size: number
  readonly content_hash: string
}

export interface FolderMetadata {
  readonly name: string
  readonly path_display: string
}

export type LookupFailureTag = 'not_found' | 'incorrect_offset' | 'closed' | 'not_closed' | 'too_large'

const LOOKUP_FAILURE_TAGS: readonly string[] = [
  'not_found',
  'incorrect_offset',
  'closed',
  'not_closed',
  'too_large',
] satisfies LookupFailureTag[]

export class DropboxError extends CloudError {
  override name = 'DropboxError'

  /** `detail` is the response's parsed `error` field; `userMessage` its readable `user_message`, if any. */
  constructor(
    readonly status: number,
    readonly summary: string,
    readonly detail: unknown,
    readonly userMessage: string | null = null,
  ) {
    super('Dropbox', userMessage ?? summary)
  }
}

/** Uploads a file of up to 150 MiB in one request. `contentHash` is the Dropbox content hash of `bytes`. */
export async function upload(
  path: string,
  bytes: Uint8Array<ArrayBuffer>,
  contentHash: string,
  signal?: AbortSignal,
): Promise<FileMetadata> {
  const arg = { path, mode: 'add', autorename: false, mute: true, content_hash: contentHash }
  return readFileMetadata(await request(`${CONTENT_URL}/files/upload`, { arg, bytes }, signal))
}

/** Starts an upload session with its first bytes and returns the session ID. */
export async function startSession(
  bytes: Uint8Array<ArrayBuffer>,
  contentHash: string,
  signal?: AbortSignal,
): Promise<string> {
  const arg = { close: false, content_hash: contentHash }
  const result: unknown = await (
    await request(`${CONTENT_URL}/files/upload_session/start`, { arg, bytes }, signal)
  ).json()
  if (!isObjectRecord(result) || typeof result.session_id != 'string') {
    throw new DropboxError(200, 'unexpected upload session response', result)
  }
  return result.session_id
}

export async function appendSession(
  sessionId: string,
  offset: number,
  bytes: Uint8Array<ArrayBuffer>,
  contentHash: string,
  signal?: AbortSignal,
): Promise<void> {
  const arg = { cursor: { session_id: sessionId, offset }, close: false, content_hash: contentHash }
  await (await request(`${CONTENT_URL}/files/upload_session/append_v2`, { arg, bytes }, signal)).arrayBuffer()
}

/** Appends the last bytes and commits the session's file to `path`. */
export async function finishSession(
  sessionId: string,
  offset: number,
  bytes: Uint8Array<ArrayBuffer>,
  contentHash: string,
  path: string,
  signal?: AbortSignal,
): Promise<FileMetadata> {
  const arg = {
    cursor: { session_id: sessionId, offset },
    commit: { path, mode: 'add', autorename: false, mute: true },
    content_hash: contentHash,
  }
  return readFileMetadata(await request(`${CONTENT_URL}/files/upload_session/finish`, { arg, bytes }, signal))
}

/** The response of an OK download, whose body streams the file. */
export async function download(path: string, signal?: AbortSignal): Promise<Response & { body: ReadableStream }> {
  const response = await request(`${CONTENT_URL}/files/download`, { arg: { path } }, signal)
  if (!response.body) {
    throw new DropboxError(response.status, 'download response has no body', null)
  }
  return response as Response & { body: ReadableStream }
}

/** The folders at the root of the App Folder. */
export async function listFolders(signal?: AbortSignal): Promise<FolderMetadata[]> {
  const folders = new Array<FolderMetadata>()
  let page = await readListFolderPage(
    await request(`${API_URL}/files/list_folder`, { json: { path: '', recursive: false } }, signal),
  )
  for (;;) {
    for (const entry of page.entries) {
      if (entry['.tag'] == 'folder' && typeof entry.name == 'string' && typeof entry.path_display == 'string') {
        folders.push({ name: entry.name, path_display: entry.path_display })
      }
    }
    if (!page.has_more) {
      return folders
    }
    page = await readListFolderPage(
      await request(`${API_URL}/files/list_folder/continue`, { json: { cursor: page.cursor } }, signal),
    )
  }
}

/** Deletes a file or folder; a path that does not exist counts as deleted. */
export async function deletePath(path: string, signal?: AbortSignal): Promise<void> {
  try {
    await (await request(`${API_URL}/files/delete_v2`, { json: { path } }, signal)).arrayBuffer()
  } catch (error) {
    if (error instanceof DropboxError && error.status == 409 && error.summary.startsWith('path_lookup/not_found')) {
      return
    }
    throw error
  }
}

/**
 * The upload session error of a failed start, append, or finish. Finish nests it under `lookup_failed`; start and
 * append report it at the top level.
 */
export function lookupFailure(error: unknown): { tag: LookupFailureTag; correctOffset: number | null } | null {
  if (!(error instanceof DropboxError) || !isObjectRecord(error.detail)) {
    return null
  }
  const lookup =
    error.detail['.tag'] == 'lookup_failed' && isObjectRecord(error.detail.lookup_failed)
      ? error.detail.lookup_failed
      : error.detail
  const tag = lookup['.tag']
  if (typeof tag != 'string' || !LOOKUP_FAILURE_TAGS.includes(tag)) {
    return null
  }
  const correctOffset =
    tag == 'incorrect_offset' && typeof lookup.correct_offset == 'number' ? lookup.correct_offset : null
  return { tag: tag as LookupFailureTag, correctOffset }
}

export function isNotFound(error: unknown): boolean {
  return error instanceof DropboxError && error.status == 409 && error.summary.startsWith('path/not_found')
}

interface RequestBody {
  /** Sent as the `Dropbox-API-Arg` header of a content endpoint. */
  readonly arg?: unknown
  /** The uploaded bytes of a content endpoint. */
  readonly bytes?: Uint8Array<ArrayBuffer>
  /** The JSON body of an RPC endpoint. */
  readonly json?: unknown
}

/** Sends one Dropbox request, retrying transient failures, and returns the OK response. */
async function request(url: string, { arg, bytes, json }: RequestBody, signal?: AbortSignal): Promise<Response> {
  for (let attempt = 1; ; ++attempt) {
    signal?.throwIfAborted()
    const headers: Record<string, string> = { Authorization: `Bearer ${await getAccessToken()}` }
    let body: BodyInit | undefined
    if (arg !== undefined) {
      headers['Dropbox-API-Arg'] = headerSafeJson(arg)
    }
    if (bytes) {
      headers['Content-Type'] = 'application/octet-stream'
      body = bytes
    } else if (json !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(json)
    }

    let response: Response
    try {
      response = await fetch(url, { method: 'POST', headers, body, signal })
    } catch (error) {
      // Network failures are TypeErrors; an abort is a DOMException and ends the request.
      if (!(error instanceof TypeError)) {
        throw error
      }
      await waitBeforeRetry('Dropbox', attempt, null, signal)
      continue
    }
    if (response.ok) {
      return response
    }

    const text = await response.text()
    let parsed: unknown = null
    try {
      parsed = JSON.parse(text)
    } catch {
      // Gateways, rate limiting, and argument errors may answer with plain text.
    }
    const detail = isObjectRecord(parsed) ? parsed.error : undefined
    const userMessage =
      isObjectRecord(parsed) && isObjectRecord(parsed.user_message) && typeof parsed.user_message.text == 'string'
        ? parsed.user_message.text
        : null
    // A scope the token lacks comes as 401 `missing_scope`, or as 400 with only a sentence naming the scope.
    const missingScope =
      isObjectRecord(detail) && detail['.tag'] == 'missing_scope' && typeof detail.required_scope == 'string'
        ? detail.required_scope
        : /required scope '([^']+)'/.exec(userMessage ?? text)?.[1]
    if (missingScope || response.status == 401) {
      // A token never gains scopes, so either way only a new authorization helps.
      await clearToken()
      throw missingScope
        ? new DropboxPermissionError([missingScope])
        : new DropboxAuthorizationError('Dropbox authorization expired. Reconnect Dropbox to continue.')
    }
    const summary =
      isObjectRecord(parsed) && typeof parsed.error_summary == 'string'
        ? parsed.error_summary
        : text.trim().slice(0, 200) || `HTTP ${response.status}`
    const transient =
      response.status == 429 ||
      response.status >= 500 ||
      (response.status == 409 &&
        (summary.includes('content_hash_mismatch') || summary.includes('too_many_write_operations')))
    if (!transient) {
      if (summary.includes('insufficient_space')) {
        throw new CloudStorageFullError('Your Dropbox is full.')
      }
      throw new DropboxError(response.status, summary, detail, userMessage)
    }
    await waitBeforeRetry('Dropbox', attempt, retryAfterSeconds(detail, response), signal)
  }
}

function retryAfterSeconds(detail: unknown, response: Response): number | null {
  if (isObjectRecord(detail) && typeof detail.retry_after == 'number') {
    return detail.retry_after
  }
  return retryAfterHeaderSeconds(response)
}

/** JSON for an HTTP header: every non-ASCII character escaped. */
function headerSafeJson(arg: unknown): string {
  return JSON.stringify(arg).replace(
    /[\u007f-\uffff]/g,
    (character) => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'),
  )
}

async function readFileMetadata(response: Response): Promise<FileMetadata> {
  const metadata: unknown = await response.json()
  if (!isObjectRecord(metadata) || typeof metadata.size != 'number' || typeof metadata.content_hash != 'string') {
    throw new DropboxError(response.status, 'unexpected file metadata', metadata)
  }
  return { size: metadata.size, content_hash: metadata.content_hash }
}

async function readListFolderPage(
  response: Response,
): Promise<{ entries: Array<Record<string, unknown>>; cursor: string; has_more: boolean }> {
  const page: unknown = await response.json()
  if (
    !isObjectRecord(page) ||
    !Array.isArray(page.entries) ||
    typeof page.cursor != 'string' ||
    typeof page.has_more != 'boolean'
  ) {
    throw new DropboxError(response.status, 'unexpected folder listing', page)
  }
  return { entries: page.entries.filter(isObjectRecord), cursor: page.cursor, has_more: page.has_more }
}
