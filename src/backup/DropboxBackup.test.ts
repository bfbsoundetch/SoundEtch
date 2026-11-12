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
import { DropboxBackup } from './DropboxBackup'

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

function dropboxErrorResponse(status: number, summary: string, error: unknown): Response {
  return Response.json({ error_summary: summary, error }, { status })
}

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
  /** Runs before each request; a response it returns replaces Dropbox's. */
  intercept: (endpoint: string, arg: Record<string, any>) => Response | void | Promise<Response | void> = () => {}

  readonly fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input))
    const endpoint = url.pathname.replace(/^\/2/, '')
    const headers = new Headers(init.headers)
    if (headers.get('Authorization') != 'Bearer t') {
      return new Response('unauthorized', { status: 401 })
    }
    const isContent = url.hostname == 'content.dropboxapi.com'
    const body = init.body == null ? new Uint8Array() : new Uint8Array(await new Response(init.body).arrayBuffer())
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
        )
      }
      case '/files/list_folder':
      case '/files/list_folder/continue': {
        // One folder per page, so listing follows the cursor.
        const folders = [...new Set([...this.files.keys()].map((path) => path.split('/')[1]))]
        const index = endpoint == '/files/list_folder' ? 0 : Number(arg.cursor)
        const entries = folders
          .slice(index, index + 1)
          .map((name) => ({ '.tag': 'folder', name, path_display: `/${name}`, path_lower: `/${name}`.toLowerCase() }))
        return Response.json({ entries, cursor: String(index + 1), has_more: index + 1 < folders.length })
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

let dropbox: FakeDropbox
const directories = new Set<string>()

beforeEach(async () => {
  dropbox = new FakeDropbox()
  vi.stubGlobal('fetch', dropbox.fetch)
  await putRecord({ key: 'token', accessToken: 't', expiresAt: Date.now() + 3_600_000, accountId: 'a' })
})

afterEach(async () => {
  dropbox.intercept = () => {}
  await DropboxBackup.cancel()
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

test('a backup restores as a new project with identical files under remapped clip ids', async () => {
  const { project, clip, files } = await createSourceProject()

  expect(await DropboxBackup.start(project)).toEqual({ kind: 'complete', projectTitle: 'Backup source' })
  expect([...dropbox.files.keys()].filter((path) => path.endsWith('/backup.json'))).toHaveLength(1)

  const listings = await DropboxBackup.listBackups()
  expect(listings).toHaveLength(1)
  const progress = new Array<[number, number]>()
  const restoredId = await DropboxBackup.restore(listings[0], (written, total) => progress.push([written, total]))
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
})

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

  expect(await DropboxBackup.start(project)).toMatchObject({ kind: 'paused', reason: 'dropbox-full' })
  expect((await getRecord<{ session: { offset: number } }>('backup-job'))?.session.offset).toBe(16 * MiB)
  expect(await DropboxBackup.resume()).toEqual({ kind: 'complete', projectTitle: 'Backup source' })

  expect(dropbox.acceptedRanges).toEqual([
    [0, 8 * MiB],
    [8 * MiB, 16 * MiB],
    [16 * MiB, 20 * MiB],
  ])
  const uploaded = [...dropbox.files].find(([path]) => path.endsWith(`/opfs/${clip.filename}`))![1]
  expect(sameBytes(uploaded, files.get(clip.filename)!)).toBe(true)
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

  expect(await DropboxBackup.start(project)).toEqual({
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
  await DropboxBackup.start(project)
  const [listing] = await DropboxBackup.listBackups()
  const recording = [...dropbox.files].find(([path]) => path.endsWith(`/opfs/${clip.filename}`))![1]
  recording[12_345] ^= 0xff
  const projectsBefore = (await ProjectManager.getProjects()).map((candidate) => candidate.id)

  await expect(DropboxBackup.restore(listing, () => {})).rejects.toThrow(
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

  expect(await DropboxBackup.start(project)).toMatchObject({
    kind: 'paused',
    reason: 'authorization',
    message:
      "SoundEtch's Dropbox app lacks the “files.content.write” permission. Enable it on the app's Permissions tab in the Dropbox App Console, then reconnect Dropbox.",
  })
  expect(await getRecord('token')).toBeUndefined()
})

test('a project that is not 48 kHz is refused before anything is written', async () => {
  const project = await ProjectManager.createProject('x', 44_100)
  directories.add(project.directoryName)

  await expect(DropboxBackup.start(project)).rejects.toThrow('Backup needs a 48 kHz project; “x” uses 44100 Hz.')
  expect(await getRecord('backup-job')).toBeUndefined()
  expect(await getRecord('backup-manifest')).toBeUndefined()
  await DatabasePersister.deleteObjectsByIds([project.id!])
})
