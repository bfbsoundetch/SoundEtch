import 'fake-indexeddb/auto'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import { GlobalSettings } from '../global/GlobalSettings'
import { DatabasePersister } from '../persistence/DatabasePersister'
import { Clip } from '../project/Clip'
import { ClipView } from '../project/ClipView'
import type { Project } from '../project/Project'
import { ProjectManager } from '../project/ProjectManager'
import { Track } from '../project/Track'
import { getRecord, putRecord } from './BackupStore'
import { CloudBackup } from './CloudBackup'
import { connectS3, getS3Settings, isS3Connected } from './S3Storage'
import { presignS3Url } from './S3Signer'
import { getCloudStorage } from './CloudProviders'
import { uploadToLink, UploadLinkUnusableError } from '../remote/CloudUploadLink'

GlobalSettings.useMemoryFS = true

const MiB = 1024 * 1024
const BLOCK_SIZE = 4 * MiB

/** Dropbox's content hash, computed independently of the code under test. */
function referenceContentHash(data: Uint8Array): string {
  const blockDigests = new Array<Buffer>()
  for (let offset = 0; offset < data.length; offset += BLOCK_SIZE) {
    blockDigests.push(
      createHash('sha256')
        .update(data.subarray(offset, offset + BLOCK_SIZE))
        .digest(),
    )
  }
  return createHash('sha256').update(Buffer.concat(blockDigests)).digest('hex')
}

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return Buffer.from(left.buffer, left.byteOffset, left.byteLength).equals(
    Buffer.from(right.buffer, right.byteOffset, right.byteLength),
  )
}

function pseudoRandomBytes(length: number, seed: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length)
  let state = seed
  for (let index = 0; index < length; ++index) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    bytes[index] = state & 0xff
  }
  return bytes
}

async function readBody(init: RequestInit): Promise<Uint8Array> {
  return init.body == null ? new Uint8Array() : new Uint8Array(await new Response(init.body).arrayBuffer())
}

/** Streams `file` in 1 MiB pieces, as a network response would. */
function streamedResponse(file: Uint8Array, headers?: HeadersInit): Response {
  const pieces = new Array<Uint8Array>()
  for (let offset = 0; offset < file.length; offset += MiB) {
    pieces.push(file.slice(offset, offset + MiB))
  }
  return new Response(
    new ReadableStream({
      pull(controller) {
        const piece = pieces.shift()
        if (piece) controller.enqueue(piece)
        else controller.close()
      },
    }),
    { headers },
  )
}

function dropboxErrorResponse(status: number, summary: string, error: unknown): Response {
  return Response.json({ error_summary: summary, error }, { status })
}

const UPLOAD_LINK_ORIGIN = 'https://content.dropboxapi.com'

interface Session {
  readonly chunks: Uint8Array[]
  offset: number
  closed: boolean
}

/** An in-memory Dropbox App Folder that enforces upload session offsets and per-request content hashes. */
class FakeDropbox {
  readonly files = new Map<string, Uint8Array>()
  readonly sessions = new Map<string, Session>()
  /** The `[offset, end)` byte range of every upload session request Dropbox accepted. */
  readonly acceptedRanges = new Array<[number, number]>()
  readonly uploadLinks = new Map<string, { readonly path: string; used: boolean }>()
  /** The argument of every `get_temporary_upload_link` request. */
  readonly linkRequests = new Array<Record<string, any>>()
  /** Runs before each request; a response it returns replaces Dropbox's. */
  intercept: (endpoint: string, arg: Record<string, any>) => Response | void | Promise<Response | void> = () => {}

  readonly fetch = async (url: URL, init: RequestInit): Promise<Response> => {
    if (url.origin == UPLOAD_LINK_ORIGIN && url.pathname.startsWith('/apitul/1/')) {
      return this.consumeUploadLink(url.pathname.slice('/apitul/1/'.length), init)
    }
    const endpoint = url.pathname.replace(/^\/2/, '')
    const headers = new Headers(init.headers)
    if (headers.get('Authorization') != 'Bearer t') {
      return new Response('unauthorized', { status: 401 })
    }
    const isContent = url.hostname == 'content.dropboxapi.com'
    const body = await readBody(init)
    const arg = isContent ? JSON.parse(headers.get('Dropbox-API-Arg')!) : JSON.parse(new TextDecoder().decode(body))
    const intercepted = await this.intercept(endpoint, arg)
    if (intercepted) {
      return intercepted
    }
    if (isContent && endpoint != '/files/download' && arg.content_hash != referenceContentHash(body)) {
      return new Response('content hash of the request body does not match', { status: 400 })
    }
    switch (endpoint) {
      case '/files/upload':
        return this.commit(arg.path, body)
      case '/files/upload_session/start': {
        const sessionId = `session-${this.sessions.size + 1}`
        this.sessions.set(sessionId, { chunks: [body], offset: body.length, closed: false })
        this.acceptedRanges.push([0, body.length])
        return Response.json({ session_id: sessionId })
      }
      case '/files/upload_session/append_v2': {
        const failure = this.append(arg.cursor, body)
        return failure ? dropboxErrorResponse(409, `${failure['.tag']}/`, failure) : Response.json(null)
      }
      case '/files/upload_session/finish': {
        const failure = this.append(arg.cursor, body)
        if (failure) {
          return dropboxErrorResponse(409, `lookup_failed/${failure['.tag']}/`, {
            '.tag': 'lookup_failed',
            lookup_failed: failure,
          })
        }
        const session = this.sessions.get(arg.cursor.session_id)!
        session.closed = true
        return this.commit(arg.commit.path, Buffer.concat(session.chunks))
      }
      case '/files/download': {
        const file = this.files.get(arg.path)
        if (!file) {
          return dropboxErrorResponse(409, 'path/not_found/', { '.tag': 'path', path: { '.tag': 'not_found' } })
        }
        return streamedResponse(file)
      }
      case '/files/list_folder':
      case '/files/list_folder/continue': {
        // One entry per page, so listing follows the cursor.
        const { path, index } = endpoint == '/files/list_folder' ? { path: arg.path, index: 0 } : JSON.parse(arg.cursor)
        const entries = this.listEntries(path)
        if (!entries) {
          return dropboxErrorResponse(409, 'path/not_found/', { '.tag': 'path', path: { '.tag': 'not_found' } })
        }
        const cursor = JSON.stringify({ path, index: index + 1 })
        return Response.json({ entries: entries.slice(index, index + 1), cursor, has_more: index + 1 < entries.length })
      }
      case '/files/get_temporary_upload_link': {
        const id = `link-${this.uploadLinks.size + 1}`
        this.uploadLinks.set(id, { path: arg.commit_info.path, used: false })
        this.linkRequests.push(arg)
        return Response.json({ link: `${UPLOAD_LINK_ORIGIN}/apitul/1/${id}` })
      }
      case '/files/delete_v2': {
        const deleted = [...this.files.keys()].filter((path) => path == arg.path || path.startsWith(`${arg.path}/`))
        if (deleted.length == 0) {
          return dropboxErrorResponse(409, 'path_lookup/not_found/', { '.tag': 'path_lookup' })
        }
        deleted.forEach((path) => this.files.delete(path))
        return Response.json({ metadata: {} })
      }
    }
    return new Response('unknown endpoint', { status: 404 })
  }

  /** The entries directly in the folder at `path` ('' for the root), or null when there is no such folder. */
  private listEntries(path: string): Array<Record<string, unknown>> | null {
    const entries = new Map<string, Record<string, unknown>>()
    for (const [filePath, data] of this.files) {
      if (!filePath.startsWith(`${path}/`)) continue
      const [name, ...rest] = filePath.slice(path.length + 1).split('/')
      const childPath = `${path}/${name}`
      entries.set(
        name,
        rest.length > 0
          ? { '.tag': 'folder', name, path_display: childPath, path_lower: childPath.toLowerCase() }
          : {
              '.tag': 'file',
              name,
              path_display: childPath,
              size: data.length,
              content_hash: referenceContentHash(data),
            },
      )
    }
    return path && entries.size == 0 ? null : [...entries.values()]
  }

  /** A temporary upload link: one upload without credentials, answering 410 once consumed. */
  private async consumeUploadLink(id: string, init: RequestInit): Promise<Response> {
    const link = this.uploadLinks.get(id)
    if (!link) {
      return new Response('no such link', { status: 404 })
    }
    if (link.used) {
      return new Response('link consumed', { status: 410 })
    }
    link.used = true
    const response = this.commit(link.path, await readBody(init))
    if (!response.ok) {
      return response
    }
    const { content_hash } = await response.json()
    return Response.json({ 'content-hash': content_hash })
  }

  private append(cursor: { session_id: string; offset: number }, body: Uint8Array): Record<string, unknown> | null {
    const session = this.sessions.get(cursor.session_id)
    if (!session) {
      return { '.tag': 'not_found' }
    }
    if (session.closed) {
      return { '.tag': 'closed' }
    }
    if (cursor.offset != session.offset) {
      return { '.tag': 'incorrect_offset', correct_offset: session.offset }
    }
    session.chunks.push(body)
    session.offset += body.length
    this.acceptedRanges.push([cursor.offset, session.offset])
    return null
  }

  private commit(path: string, data: Uint8Array): Response {
    const existing = this.files.get(path)
    if (existing && !sameBytes(existing, data)) {
      return dropboxErrorResponse(409, 'path/conflict/file/', { '.tag': 'path', path: { '.tag': 'conflict' } })
    }
    this.files.set(path, data)
    return Response.json({ size: data.length, content_hash: referenceContentHash(data) })
  }
}

function s3ErrorResponse(status: number, code: string): Response {
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${code}</Message></Error>`,
    {
      status,
    },
  )
}

function xmlText(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/**
 * An in-memory path-style S3 bucket at https://s3.test/backups. Like S3, it rejects bodies that differ from the signed
 * payload hash and multipart parts below 5 MiB other than the last.
 */
class FakeS3 {
  readonly objects = new Map<string, Uint8Array>()
  readonly uploads = new Map<string, { readonly key: string; readonly parts: Map<number, Uint8Array> }>()
  /** The part number of every part the bucket accepted. */
  readonly acceptedParts = new Array<number>()
  /** False when the bucket's CORS rules hide the ETag header from the page. */
  exposeEtag = true
  /** Runs before each request; a response it returns replaces S3's. */
  intercept: (method: string, key: string, query: URLSearchParams) => Response | void = () => {}

  readonly fetch = async (url: URL, init: RequestInit): Promise<Response> => {
    const [, bucket, ...keyParts] = url.pathname.split('/')
    const key = decodeURIComponent(keyParts.join('/'))
    const method = init.method ?? 'GET'
    const headers = new Headers(init.headers)
    const body = await readBody(init)
    if (bucket != 'backups') {
      return s3ErrorResponse(404, 'NoSuchBucket')
    }
    if (url.searchParams.has('X-Amz-Signature')) {
      return this.presignedPut(url, method, key, body)
    }
    if (!headers.get('Authorization')?.startsWith('AWS4-HMAC-SHA256 Credential=AKID/')) {
      return s3ErrorResponse(403, 'AccessDenied')
    }
    if (headers.get('x-amz-content-sha256') != sha256(body)) {
      return s3ErrorResponse(400, 'XAmzContentSHA256Mismatch')
    }
    const query = url.searchParams
    const intercepted = this.intercept(method, key, query)
    if (intercepted) {
      return intercepted
    }
    if (!key) {
      return this.list(query)
    }
    const etag = (data: Uint8Array) => (this.exposeEtag ? { ETag: `"${sha256(data).slice(0, 32)}"` } : undefined)
    const uploadId = query.get('uploadId')
    if (method == 'POST' && query.has('uploads')) {
      const id = `upload-${this.uploads.size + 1}-${key.length}`
      this.uploads.set(id, { key, parts: new Map() })
      return new Response(`<InitiateMultipartUploadResult><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`)
    }
    if (uploadId != null) {
      const upload = this.uploads.get(uploadId)
      if (!upload || upload.key != key) {
        return s3ErrorResponse(404, 'NoSuchUpload')
      }
      if (method == 'PUT') {
        const partNumber = Number(query.get('partNumber'))
        upload.parts.set(partNumber, body)
        this.acceptedParts.push(partNumber)
        return new Response(null, { headers: etag(body) })
      }
      if (method == 'DELETE') {
        this.uploads.delete(uploadId)
        return new Response(null, { status: 204 })
      }
      const listed = [
        ...new TextDecoder().decode(body).matchAll(/<PartNumber>(\d+)<\/PartNumber><ETag>([^<]*)<\/ETag>/g),
      ]
      const parts = listed.map(([, partNumber, tag]) => {
        const part = upload.parts.get(Number(partNumber))
        return part && `"${sha256(part).slice(0, 32)}"` == tag ? part : null
      })
      if (parts.some((part) => !part)) {
        return s3ErrorResponse(400, 'InvalidPart')
      }
      if (parts.slice(0, -1).some((part) => part!.length < 5 * MiB)) {
        return s3ErrorResponse(400, 'EntityTooSmall')
      }
      this.objects.set(key, Buffer.concat(parts as Uint8Array[]))
      this.uploads.delete(uploadId)
      return new Response('<CompleteMultipartUploadResult></CompleteMultipartUploadResult>')
    }
    const object = this.objects.get(key)
    switch (method) {
      case 'PUT':
        this.objects.set(key, body)
        return new Response(null, { headers: etag(body) })
      case 'GET':
        return object ? streamedResponse(object) : s3ErrorResponse(404, 'NoSuchKey')
      case 'HEAD':
        return new Response(null, {
          status: object ? 200 : 404,
          headers: { 'Content-Length': String(object?.length ?? 0) },
        })
      case 'DELETE':
        this.objects.delete(key)
        return new Response(null, { status: 204 })
    }
    return s3ErrorResponse(405, 'MethodNotAllowed')
  }

  /** A query-signed request: the signature must match the secret and the URL must not have expired. */
  private async presignedPut(url: URL, method: string, key: string, body: Uint8Array): Promise<Response> {
    const query = url.searchParams
    const date = new Date(
      query.get('X-Amz-Date')!.replace(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/, '$1-$2-$3T$4:$5:$6Z'),
    )
    const seconds = Number(query.get('X-Amz-Expires'))
    const credentials = { accessKeyId: 'AKID', secretAccessKey: 'secret', region: 'us-east-1' }
    const expected = await presignS3Url(
      { method, host: url.host, path: url.pathname, query: [] },
      credentials,
      date,
      seconds,
    )
    if (new URL(expected).searchParams.get('X-Amz-Signature') != query.get('X-Amz-Signature')) {
      return s3ErrorResponse(403, 'SignatureDoesNotMatch')
    }
    if (Date.now() > date.getTime() + seconds * 1000) {
      return s3ErrorResponse(403, 'AccessDenied')
    }
    if (method != 'PUT') {
      return s3ErrorResponse(405, 'MethodNotAllowed')
    }
    this.objects.set(key, body)
    return new Response(null, { headers: { ETag: `"${sha256(body).slice(0, 32)}"` } })
  }

  /** ListObjectsV2, one key or common prefix per page, so listing follows the continuation token. */
  private list(query: URLSearchParams): Response {
    const prefix = query.get('prefix') ?? ''
    const delimiter = query.get('delimiter')
    const entries = new Array<string>()
    for (const key of [...this.objects.keys()].sort()) {
      if (!key.startsWith(prefix)) continue
      const end = delimiter ? key.indexOf(delimiter, prefix.length) : -1
      const entry = end < 0 ? key : key.slice(0, end + 1)
      if (!entries.includes(entry)) entries.push(entry)
    }
    const index = Number(query.get('continuation-token') ?? 0)
    const entry = entries[index]
    const truncated = index + 1 < entries.length
    return new Response(
      `<ListBucketResult><Name>backups</Name><Prefix>${xmlText(prefix)}</Prefix>` +
        `<IsTruncated>${truncated}</IsTruncated>${truncated ? `<NextContinuationToken>${index + 1}</NextContinuationToken>` : ''}` +
        (entry == undefined
          ? ''
          : entry.endsWith('/') && delimiter
            ? `<CommonPrefixes><Prefix>${xmlText(entry)}</Prefix></CommonPrefixes>`
            : `<Contents><Key>${xmlText(entry)}</Key><Size>${this.objects.get(entry)!.length}</Size></Contents>`) +
        '</ListBucketResult>',
    )
  }
}

const s3Settings = {
  endpoint: 'https://s3.test',
  region: 'us-east-1',
  bucket: 'backups',
  prefix: 'soundetch/',
  accessKeyId: 'AKID',
  pathStyle: true,
}

let dropbox: FakeDropbox
let s3: FakeS3
const directories = new Set<string>()

beforeEach(async () => {
  dropbox = new FakeDropbox()
  s3 = new FakeS3()
  vi.stubGlobal('fetch', async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input))
    return url.hostname == 's3.test' ? s3.fetch(url, init) : dropbox.fetch(url, init)
  })
  await putRecord({ key: 'dropbox-token', accessToken: 't', expiresAt: Date.now() + 3_600_000, accountId: 'a' })
  await putRecord({ key: 's3-settings', ...s3Settings, secretAccessKey: 'secret' })
})

afterEach(async () => {
  dropbox.intercept = () => {}
  s3.intercept = () => {}
  await CloudBackup.cancel()
  vi.unstubAllGlobals()
  for (const directory of directories) await FileSystemUtils.deleteDirectory(directory)
  directories.clear()
})

async function writeFile(directory: string, name: string, bytes: Uint8Array<ArrayBuffer>) {
  const writer = await FileSystemUtils.createFileWriter(directory, name)
  await writer.write(bytes)
  await writer.close()
}

/** A project with a 20 MiB recording, its summary, and a video sidecar; returns each file's name and bytes. */
async function createSourceProject(): Promise<{ project: Project; clip: Clip; files: Map<string, Uint8Array> }> {
  const project = await ProjectManager.createProject('Backup source', 48_000)
  directories.add(project.directoryName)
  const clip = new Clip('recording', 1, 5 * MiB)
  clip.videoLength = 5 * MiB
  clip.videoSegments = [
    { index: 0, trackNumber: 1, startSample: 0, length: 5 * MiB, mediaStartSeconds: 0, mimeType: 'video/webm' },
  ]
  await ProjectManager.addNewClip(clip)
  const track = new Track('recording', 1)
  track.addClipView(new ClipView(clip, 0, 0, clip.length))
  await ProjectManager.saveTrack(track)
  await ProjectManager.addTrackToProject(track, 0)
  const files = new Map<string, Uint8Array<ArrayBuffer>>([
    [clip.filename, pseudoRandomBytes(20 * MiB, 1)],
    [`${clip.filename}_summary`, pseudoRandomBytes(4096, 2)],
    [`${clip.filename}_video_0`, pseudoRandomBytes(300_000, 3)],
  ])
  for (const [name, bytes] of files) {
    await writeFile(project.directoryName, name, bytes)
  }
  await ProjectManager.saveProject(project)
  return { project, clip, files }
}

test.each(['dropbox', 's3'] as const)(
  'a %s backup restores as a new project with identical files under remapped clip ids',
  async (provider) => {
    const { project, clip, files } = await createSourceProject()

    expect(await CloudBackup.start(project, provider)).toEqual({ kind: 'complete', projectTitle: 'Backup source' })
    const stored = provider == 'dropbox' ? [...dropbox.files.keys()] : [...s3.objects.keys()]
    expect(stored.filter((path) => path.endsWith('/backup.json'))).toHaveLength(1)
    if (provider == 's3') {
      expect(stored.every((key) => key.startsWith('soundetch/Backup source '))).toBe(true)
      expect(s3.uploads.size).toBe(0)
    }

    const listings = await CloudBackup.listBackups(provider)
    expect(listings).toHaveLength(1)
    const progress = new Array<[number, number]>()
    const restoredId = await CloudBackup.restore(listings[0], (written, total) => progress.push([written, total]))
    directories.add(String(restoredId))

    expect(restoredId).not.toBe(project.id)
    const restored = (await ProjectManager.getProjects()).find((candidate) => candidate.id == restoredId)!
    expect(restored.title).toBe('Backup source')
    const restoredClip = restored.getClips()[0]
    expect(restoredClip.id).not.toBe(clip.id)
    const restoredFiles = await FileSystemUtils.getDirectoryFiles(String(restoredId))
    expect(restoredFiles.map((file) => file.path).sort()).toEqual(
      [...files.keys()].map((name) => name.replace(clip.filename, restoredClip.filename)).sort(),
    )
    for (const [name, bytes] of files) {
      const file = restoredFiles.find(
        (candidate) => candidate.path == name.replace(clip.filename, restoredClip.filename),
      )!
      expect(sameBytes(new Uint8Array(await file.data.arrayBuffer()), bytes), name).toBe(true)
    }
    expect(progress.at(-1)).toEqual([listings[0].totalBytes, listings[0].totalBytes])
  },
)

test('a paused upload resumes without sending any byte range twice', async () => {
  const { project, clip, files } = await createSourceProject()
  let finishAttempts = 0
  dropbox.intercept = (endpoint) => {
    if (endpoint == '/files/upload_session/finish' && finishAttempts++ == 0) {
      return dropboxErrorResponse(409, 'path/insufficient_space/', {
        '.tag': 'path',
        path: { '.tag': 'insufficient_space' },
      })
    }
  }

  expect(await CloudBackup.start(project, 'dropbox')).toMatchObject({
    kind: 'paused',
    reason: 'storage-full',
    message: 'Your Dropbox is full. Free space in Dropbox, then resume the backup.',
  })
  expect((await getRecord<{ session: { offset: number } }>('backup-job'))?.session.offset).toBe(16 * MiB)
  expect(await CloudBackup.resume()).toEqual({ kind: 'complete', projectTitle: 'Backup source' })

  expect(dropbox.acceptedRanges).toEqual([
    [0, 0],
    [0, 8 * MiB],
    [8 * MiB, 16 * MiB],
    [16 * MiB, 20 * MiB],
  ])
  const uploaded = [...dropbox.files].find(([path]) => path.endsWith(`/opfs/${clip.filename}`))![1]
  expect(sameBytes(uploaded, files.get(clip.filename)!)).toBe(true)
})

test('a refused S3 key pauses the backup and disconnects; reconnecting resumes without resending parts', async () => {
  const { project, clip, files } = await createSourceProject()
  let refused = false
  s3.intercept = (method, _key, query) => {
    if (method == 'PUT' && query.get('partNumber') == '2' && !refused) {
      refused = true
      return s3ErrorResponse(403, 'AccessDenied')
    }
  }

  expect(await CloudBackup.start(project, 's3')).toMatchObject({
    kind: 'paused',
    reason: 'authorization',
    message:
      'S3 refused the access key (AccessDenied: AccessDenied). Connect S3 with a key that can list, read, write, and delete in the bucket.',
  })
  expect(await isS3Connected()).toBe(false)
  expect(await getS3Settings()).toEqual(s3Settings)

  await connectS3(s3Settings, 'secret')
  expect(await CloudBackup.resume()).toEqual({ kind: 'complete', projectTitle: 'Backup source' })
  expect(s3.acceptedParts).toEqual([1, 2, 3])
  expect(s3.uploads.size).toBe(0)
  const uploaded = [...s3.objects].find(([key]) => key.endsWith(`/opfs/${clip.filename}`))![1]
  expect(sameBytes(uploaded, files.get(clip.filename)!)).toBe(true)
})

test('cancelling a paused S3 backup aborts its multipart upload and deletes what it stored', async () => {
  const { project } = await createSourceProject()
  s3.intercept = (method, _key, query) => {
    if (method == 'PUT' && query.get('partNumber') == '2') {
      return s3ErrorResponse(400, 'InvalidArgument')
    }
  }

  expect(await CloudBackup.start(project, 's3')).toMatchObject({
    kind: 'paused',
    reason: 'error',
    message: 'S3 rejected the backup (InvalidArgument: InvalidArgument). Resume to retry or cancel the backup.',
  })
  expect(s3.uploads.size).toBe(1)
  expect(s3.objects.size).toBeGreaterThan(0)

  await CloudBackup.cancel()
  expect(s3.uploads.size).toBe(0)
  expect([...s3.objects.keys()]).toEqual([])
})

test('connecting S3 through CORS rules that hide the ETag header fails with what to fix and leaves nothing behind', async () => {
  await putRecord({ key: 's3-settings', ...s3Settings, secretAccessKey: null })
  s3.exposeEtag = false

  await expect(
    connectS3({ ...s3Settings, endpoint: ' https://s3.test/ ', prefix: '/soundetch' }, 'secret'),
  ).rejects.toThrow("Add ETag to the bucket's exposed CORS headers.")
  expect(await isS3Connected()).toBe(false)
  expect(await getS3Settings()).toEqual(s3Settings)
  expect([...s3.objects.keys()]).toEqual([])
})

test('a file that changes during the backup fails it and removes the partial backup', async () => {
  const { project, clip, files } = await createSourceProject()
  let rewritten = false
  dropbox.intercept = async (endpoint) => {
    if (endpoint == '/files/upload_session/start' && !rewritten) {
      rewritten = true
      const longer = new Uint8Array(files.get(clip.filename)!.length + 1)
      longer.set(files.get(clip.filename)!)
      await writeFile(project.directoryName, clip.filename, longer)
    }
  }

  expect(await CloudBackup.start(project, 'dropbox')).toEqual({
    kind: 'failed',
    projectTitle: 'Backup source',
    message: '“Backup source” changed during the backup. Back it up again.',
  })
  expect(rewritten).toBe(true)
  expect([...dropbox.files.keys()]).toEqual([])
  expect(await getRecord('backup-job')).toBeUndefined()
  expect(await getRecord('backup-manifest')).toBeUndefined()
})

test('restoring a corrupted backup fails and leaves no project behind', async () => {
  const { project, clip } = await createSourceProject()
  await CloudBackup.start(project, 'dropbox')
  const [listing] = await CloudBackup.listBackups('dropbox')
  const recording = [...dropbox.files].find(([path]) => path.endsWith(`/opfs/${clip.filename}`))![1]
  recording[12_345] ^= 0xff
  const projectsBefore = (await ProjectManager.getProjects()).map((candidate) => candidate.id)

  await expect(CloudBackup.restore(listing, () => {})).rejects.toThrow(
    'does not match its recorded size or content hash',
  )
  expect((await ProjectManager.getProjects()).map((candidate) => candidate.id)).toEqual(projectsBefore)
})

test('a token without the write scope pauses the backup with what to fix and disconnects', async () => {
  const { project } = await createSourceProject()
  // What Dropbox answers when the app had not enabled the scope as the user authorized it.
  dropbox.intercept = () =>
    Response.json(
      {
        error: { '.tag': 'other' },
        error_summary: 'other/...',
        user_message: {
          locale: 'en',
          text: `Error in call to API function "files/upload": Your app (ID: 1) is not permitted to access this endpoint because it does not have the required scope 'files.content.write'. The owner of the app can enable the scope for the app using the Permissions tab on the App Console.`,
        },
      },
      { status: 400 },
    )

  expect(await CloudBackup.start(project, 'dropbox')).toMatchObject({
    kind: 'paused',
    reason: 'authorization',
    message:
      "SoundEtch's Dropbox app lacks the “files.content.write” permission. Enable it on the app's Permissions tab in the Dropbox App Console, then reconnect Dropbox.",
  })
  expect(await getRecord('dropbox-token')).toBeUndefined()
})

test('a project that is not 48 kHz is refused before anything is written', async () => {
  const project = await ProjectManager.createProject('x', 44_100)
  directories.add(project.directoryName)

  await expect(CloudBackup.start(project, 'dropbox')).rejects.toThrow(
    'Backup needs a 48 kHz project; “x” uses 44100 Hz.',
  )
  expect(await getRecord('backup-job')).toBeUndefined()
  expect(await getRecord('backup-manifest')).toBeUndefined()
  await DatabasePersister.deleteObjectsByIds([project.id!])
})

test('files directly in a folder list with sizes, and Dropbox content hashes; a missing folder lists as null', async () => {
  const first = pseudoRandomBytes(1000, 4)
  const second = pseudoRandomBytes(2000, 5)
  dropbox.files.set('/Meeting/audio-00001.pcm', first)
  dropbox.files.set('/Meeting/video-00001.part', second)
  dropbox.files.set('/Meeting/nested/other', second)
  s3.objects.set('soundetch/Meeting/audio-00001.pcm', first)
  s3.objects.set('soundetch/Meeting/video-00001.part', second)
  s3.objects.set('soundetch/Meeting/nested/other', second)

  expect(await getCloudStorage('dropbox').listFiles('/Meeting')).toEqual([
    { name: 'audio-00001.pcm', size: 1000, contentHash: referenceContentHash(first) },
    { name: 'video-00001.part', size: 2000, contentHash: referenceContentHash(second) },
  ])
  expect(await getCloudStorage('s3').listFiles('/Meeting')).toEqual([
    { name: 'audio-00001.pcm', size: 1000, contentHash: null },
    { name: 'video-00001.part', size: 2000, contentHash: null },
  ])
  expect(await getCloudStorage('dropbox').listFiles('/Missing')).toBeNull()
  expect(await getCloudStorage('s3').listFiles('/Missing')).toBeNull()
})

test('a Dropbox upload link takes one upload, returns its content hash, then answers 410', async () => {
  const bytes = pseudoRandomBytes(5000, 6)
  const link = await getCloudStorage('dropbox').createUploadLink('/Meeting/audio-00001.pcm', 86_400)

  expect(link).toMatchObject({ method: 'POST', singleUse: true })
  expect(dropbox.linkRequests).toEqual([
    {
      commit_info: { path: '/Meeting/audio-00001.pcm', mode: 'add', autorename: false, mute: true },
      duration: 14_400,
    },
  ])
  expect(await uploadToLink(link, bytes)).toBe(referenceContentHash(bytes))
  expect(sameBytes(dropbox.files.get('/Meeting/audio-00001.pcm')!, bytes)).toBe(true)
  await expect(uploadToLink(link, bytes)).rejects.toEqual(new UploadLinkUnusableError(410))

  // Different bytes through a fresh link for the same path conflict in mode add.
  const fresh = await getCloudStorage('dropbox').createUploadLink('/Meeting/audio-00001.pcm', 60)
  const error = await uploadToLink(fresh, pseudoRandomBytes(5000, 7)).catch((caught: unknown) => caught)
  expect(error).toBeInstanceOf(UploadLinkUnusableError)
  expect((error as UploadLinkUnusableError).status).toBe(409)
})

test('an S3 upload link is a presigned PUT that stores, replaces, and fails with 403 once expired or altered', async () => {
  const link = await getCloudStorage('s3').createUploadLink('/Meeting/audio-00001.pcm', 10_000_000)

  expect(link).toMatchObject({ method: 'PUT', singleUse: false })
  expect(new URL(link.url).searchParams.get('X-Amz-Expires')).toBe('604800')
  const first = pseudoRandomBytes(5000, 8)
  const second = pseudoRandomBytes(3000, 9)
  expect(await uploadToLink(link, first)).toBeNull()
  expect(sameBytes(s3.objects.get('soundetch/Meeting/audio-00001.pcm')!, first)).toBe(true)
  expect(await uploadToLink(link, second)).toBeNull()
  expect(sameBytes(s3.objects.get('soundetch/Meeting/audio-00001.pcm')!, second)).toBe(true)

  const altered = { ...link, url: link.url.replace('audio-00001', 'audio-00002') }
  await expect(uploadToLink(altered, first)).rejects.toEqual(new UploadLinkUnusableError(403))

  const shortLived = await getCloudStorage('s3').createUploadLink('/Meeting/audio-00003.pcm', 60)
  vi.useFakeTimers({ now: Date.now() + 61_000, toFake: ['Date'] })
  try {
    await expect(uploadToLink(shortLived, first)).rejects.toEqual(new UploadLinkUnusableError(403))
  } finally {
    vi.useRealTimers()
  }
  expect(s3.objects.has('soundetch/Meeting/audio-00002.pcm')).toBe(false)
  expect(s3.objects.has('soundetch/Meeting/audio-00003.pcm')).toBe(false)
})
