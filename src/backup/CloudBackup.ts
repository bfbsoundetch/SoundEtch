import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import { isObjectRecord } from '../global/TypeGuards'
import type { Project } from '../project/Project'
import {
  MAX_PROJECT_ARCHIVE_MANIFEST_SIZE,
  PROJECT_ARCHIVE_FILE_PREFIX,
  PROJECT_ARCHIVE_MANIFEST_NAME,
  ProjectArchive,
  type ProjectArchiveMember,
} from '../project/ProjectArchive'
import { humanizeBytes } from '../ui/DiskUsage'
import { deleteRecord, getRecord, putRecord } from './BackupStore'
import { getCloudStorage } from './CloudProviders'
import {
  CloudAuthorizationError,
  CloudError,
  CloudStorageFullError,
  CloudUnavailableError,
  CloudUploadLostError,
  type ChunkedUploadState,
  type CloudProviderId,
  type CloudStorage,
} from './CloudStorage'
import { contentHash, ContentHasher, fromHex, toHex } from './ContentHasher'

export type BackupPauseReason = 'interrupted' | 'authorization' | 'network' | 'storage-full' | 'error'

export type BackupStatus =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'uploading'
      readonly projectTitle: string
      readonly uploadedBytes: number
      readonly totalBytes: number
    }
  | {
      readonly kind: 'paused'
      readonly projectTitle: string
      readonly uploadedBytes: number
      readonly totalBytes: number
      readonly reason: BackupPauseReason
      readonly message: string
    }
  | { readonly kind: 'complete'; readonly projectTitle: string }
  | { readonly kind: 'failed'; readonly projectTitle: string; readonly message: string }

export interface CloudBackupMember {
  /** Path inside the backup folder, as inside a project archive. */
  readonly path: string
  readonly size: number
  readonly contentHash: string
}

/** A complete backup: a folder whose `backup.json` index was written. */
export interface CloudBackupListing {
  readonly provider: CloudProviderId
  readonly folderPath: string
  readonly projectTitle: string
  readonly createdAt: string
  readonly totalBytes: number
  readonly members: readonly CloudBackupMember[]
}

interface BackupJobMember {
  readonly path: string
  readonly size: number
  /** Null for the manifest and for files that are not `File`s. */
  readonly lastModified: number | null
}

interface UploadSession {
  readonly path: string
  /** Bytes the provider acknowledged. */
  offset: number
  /** Hex digests of the acknowledged 4 MiB blocks. */
  blockHashes: string[]
  /** The provider's progress of this upload. */
  state: ChunkedUploadState
}

/** The persisted state of the one backup that may be running or paused. */
interface BackupJob {
  readonly key: typeof JOB_KEY
  readonly provider: CloudProviderId
  readonly projectId: number
  readonly projectTitle: string
  readonly folderPath: string
  readonly createdAt: string
  /** The manifest first, then the project's files. */
  readonly members: readonly BackupJobMember[]
  /** Path → verified content hash of each uploaded member. */
  uploaded: Record<string, string>
  /** The chunked upload of a large member in flight. */
  session: UploadSession | null
}

interface ManifestRecord {
  readonly key: typeof MANIFEST_KEY
  readonly data: Uint8Array
}

interface BackupIndex {
  readonly format: typeof BACKUP_FORMAT
  readonly version: 1
  readonly projectTitle: string
  readonly createdAt: string
  readonly members: readonly CloudBackupMember[]
}

const JOB_KEY = 'backup-job'
const MANIFEST_KEY = 'backup-manifest'
const BACKUP_FORMAT = 'soundetch-cloud-backup'
const BACKUP_INDEX_NAME = 'backup.json'
const BACKUP_LOCK_NAME = 'soundetch-cloud-backup'
const MAX_BACKUP_INDEX_SIZE = 1024 * 1024
const LISTING_CONCURRENCY = 4
/**
 * Larger members upload in chunks, one per request. A multiple of the 4 MiB hash block, and above S3's 5 MiB minimum
 * part size.
 */
const UPLOAD_CHUNK_SIZE = 8 * 1024 * 1024

/** A project file differs from the snapshot the backup started with. */
class ProjectChangedError extends Error {
  override name = 'ProjectChangedError'
}

/**
 * Backs up a saved project to a cloud provider, one remote file per project file, and restores backups. One backup runs
 * or waits paused at a time, whichever provider it targets.
 */
export class CloudBackup {
  private static status: BackupStatus = { kind: 'idle' }
  private static readonly listeners = new Set<(status: BackupStatus) => void>()
  /** The backup operation running in this tab. */
  private static running: { readonly controller: AbortController; readonly completion: Promise<unknown> } | null = null

  /** Calls `listener` now and on every status change. */
  static addStatusListener(listener: (status: BackupStatus) => void): void {
    CloudBackup.listeners.add(listener)
    listener(CloudBackup.status)
  }

  static getStatus(): BackupStatus {
    return CloudBackup.status
  }

  /** The provider of the backup that is running or paused, if any. */
  static async getJobProvider(): Promise<CloudProviderId | null> {
    return (await getRecord<BackupJob>(JOB_KEY))?.provider ?? null
  }

  /** Reports a backup that a reload or crash interrupted, so the user can resume it. */
  static async loadInterruptedJob(): Promise<void> {
    const job = await getRecord<BackupJob>(JOB_KEY)
    const { kind } = CloudBackup.status
    if (!job || CloudBackup.running || kind == 'uploading' || kind == 'paused') {
      return
    }
    CloudBackup.setStatus({
      kind: 'paused',
      projectTitle: job.projectTitle,
      uploadedBytes: CloudBackup.getUploadedBytes(job),
      totalBytes: CloudBackup.getTotalBytes(job),
      reason: 'interrupted',
      message: `Backup of “${job.projectTitle}” was interrupted. Resume to continue.`,
    })
  }

  /**
   * Backs up `project`, which the caller has stopped recording into and saved, to `provider`. Rejects when the backup
   * cannot start; once it runs, resolves with the final status, `paused` or `failed` included.
   */
  static start(project: Project, provider: CloudProviderId): Promise<BackupStatus> {
    if (CloudBackup.status.kind == 'paused') {
      return Promise.reject(new Error('A backup is already in progress.'))
    }
    return CloudBackup.runExclusively(async (signal) => {
      if (await getRecord<BackupJob>(JOB_KEY)) {
        throw new Error('A backup is already in progress.')
      }
      if (project.sampleRate != 48000) {
        throw new Error(`Backup needs a 48 kHz project; “${project.title}” uses ${project.sampleRate} Hz.`)
      }
      if (project.getClips().some((clip) => clip.videoRecordingInProgress)) {
        throw new Error(
          `A video recording in “${project.title}” has not been recovered yet. Reopen the project, then back it up.`,
        )
      }
      const snapshot = await ProjectArchive.snapshotProject(project)
      const createdAt = new Date().toISOString()
      // Code points, so the cut never splits a surrogate pair.
      const folderTitle = Array.from(ProjectArchive.getSafeFileTitle(project.title)).slice(0, 100).join('')
      const job: BackupJob = {
        key: JOB_KEY,
        provider,
        projectId: project.id!,
        projectTitle: project.title,
        folderPath: `/${folderTitle} ${createdAt.slice(0, 19).replaceAll(':', '-')}`,
        createdAt,
        members: [
          { path: PROJECT_ARCHIVE_MANIFEST_NAME, size: snapshot.manifest.size, lastModified: null },
          ...snapshot.files.map((file) => ({
            path: `${PROJECT_ARCHIVE_FILE_PREFIX}${file.path}`,
            size: file.data.size,
            lastModified: file.data instanceof File ? file.data.lastModified : null,
          })),
        ],
        uploaded: {},
        session: null,
      }
      const manifest: ManifestRecord = {
        key: MANIFEST_KEY,
        data: new Uint8Array(await snapshot.manifest.arrayBuffer()),
      }
      signal.throwIfAborted()
      await putRecord(manifest)
      await putRecord(job)
      return CloudBackup.runJobHoldingLock(job, signal)
    })
  }

  /** Continues the persisted backup. Resolves with its final status, `paused` or `failed` included. */
  static resume(): Promise<BackupStatus> {
    return CloudBackup.runExclusively(async (signal) => {
      const job = await getRecord<BackupJob>(JOB_KEY)
      if (!job) {
        throw new Error('No interrupted backup to resume.')
      }
      return CloudBackup.runJobHoldingLock(job, signal)
    })
  }

  /** Stops the backup and removes its local state and what it uploaded. */
  static async cancel(): Promise<void> {
    const running = CloudBackup.running
    if (running) {
      running.controller.abort()
      await running.completion.catch(() => undefined)
    }
    const job = await getRecord<BackupJob>(JOB_KEY)
    await CloudBackup.deleteJobRecords()
    if (job) {
      await CloudBackup.discardUploads(job)
    }
    CloudBackup.setStatus({ kind: 'idle' })
  }

  /** Complete backups at `provider`, newest first. */
  static async listBackups(provider: CloudProviderId): Promise<CloudBackupListing[]> {
    const storage = getCloudStorage(provider)
    const folders = await storage.listFolders()
    const listings = new Array<CloudBackupListing>()
    let next = 0
    const readFolders = async () => {
      while (next < folders.length) {
        const listing = await CloudBackup.readListing(storage, folders[next++])
        if (listing) {
          listings.push(listing)
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(LISTING_CONCURRENCY, folders.length) }, readFolders))
    return listings.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }

  /**
   * Restores `listing` as a new project and returns its id. The caller has stopped any recording. Every file is checked
   * against the index; a failure leaves no project behind.
   */
  static async restore(
    listing: CloudBackupListing,
    onProgress: (written: number, total: number) => void,
  ): Promise<number> {
    const storage = getCloudStorage(listing.provider)
    const total = listing.members.reduce((sum, member) => sum + member.size, 0)
    const estimate = await globalThis.navigator?.storage?.estimate?.()
    if (estimate?.quota != null && estimate.usage != null && estimate.quota - estimate.usage < total) {
      const free = estimate.quota - estimate.usage
      throw new Error(
        `Restoring needs ${humanizeBytes(total)} of browser storage, but only ${humanizeBytes(free)} is available.`,
      )
    }

    const manifestMember = listing.members.find((member) => member.path == PROJECT_ARCHIVE_MANIFEST_NAME)!
    if (manifestMember.size > MAX_PROJECT_ARCHIVE_MANIFEST_SIZE) {
      throw new Error("The project's metadata is larger than 16 MiB and cannot be archived")
    }
    const manifestStream = await storage.readFile(`${listing.folderPath}/${manifestMember.path}`)
    if (!manifestStream) {
      throw CloudBackup.integrityError(manifestMember.path)
    }
    const manifestBytes = new Uint8Array(await new Response(manifestStream).arrayBuffer())
    if (
      manifestBytes.length != manifestMember.size ||
      (await contentHash(manifestBytes)) != manifestMember.contentHash
    ) {
      throw CloudBackup.integrityError(manifestMember.path)
    }
    const manifest = ProjectArchive.parseManifest(manifestBytes)
    let written = manifestBytes.length
    onProgress(written, total)

    const members = listing.members
      .filter((member) => member !== manifestMember)
      .map((member): ProjectArchiveMember => ({
        name: member.path,
        copyTo: async (write) => {
          const stream = await storage.readFile(`${listing.folderPath}/${member.path}`)
          if (!stream) {
            throw CloudBackup.integrityError(member.path)
          }
          const reader = stream.getReader()
          const hasher = new ContentHasher()
          let size = 0
          for (;;) {
            const { done, value } = await reader.read()
            if (done) {
              break
            }
            size += value.length
            if (size > member.size) {
              await reader.cancel()
              throw CloudBackup.integrityError(member.path)
            }
            await hasher.update(value)
            await write(value as Uint8Array<ArrayBuffer>)
            written += value.length
            onProgress(written, total)
          }
          if (size != member.size || (await hasher.digest()) != member.contentHash) {
            throw CloudBackup.integrityError(member.path)
          }
        },
      }))
    return ProjectArchive.importMembers(manifest, members)
  }

  /** Runs one backup operation at a time in this tab; claimed synchronously, so a double click cannot start two. */
  private static runExclusively(operation: (signal: AbortSignal) => Promise<BackupStatus>): Promise<BackupStatus> {
    if (CloudBackup.running || CloudBackup.status.kind == 'uploading') {
      return Promise.reject(new Error('A backup is already in progress.'))
    }
    const controller = new AbortController()
    const completion = operation(controller.signal).finally(() => {
      if (CloudBackup.running?.controller == controller) {
        CloudBackup.running = null
      }
    })
    CloudBackup.running = { controller, completion }
    return completion
  }

  /** Runs the job unless another tab is running one. */
  private static async runJobHoldingLock(job: BackupJob, signal: AbortSignal): Promise<BackupStatus> {
    const locks: LockManager | undefined = globalThis.navigator?.locks
    if (!locks) {
      return CloudBackup.runJob(job, signal)
    }
    return locks.request(BACKUP_LOCK_NAME, { ifAvailable: true }, (lock) =>
      lock
        ? CloudBackup.runJob(job, signal)
        : CloudBackup.pause(job, 'error', 'A backup is running in another SoundEtch tab.'),
    )
  }

  private static async runJob(job: BackupJob, signal: AbortSignal): Promise<BackupStatus> {
    const storage = getCloudStorage(job.provider)
    CloudBackup.reportProgress(job)
    try {
      const manifest = await getRecord<ManifestRecord>(MANIFEST_KEY)
      if (!manifest) {
        throw new ProjectChangedError('The backup lost its project manifest')
      }
      const sources = await CloudBackup.getSources(job, manifest)
      for (const member of job.members) {
        if (member.path in job.uploaded) {
          continue
        }
        const data = CloudBackup.getUnchangedSource(sources, member)
        const remotePath = `${job.folderPath}/${member.path}`
        if (member.size <= UPLOAD_CHUNK_SIZE) {
          await CloudBackup.uploadSmallMember(storage, job, member, data, remotePath, signal)
        } else {
          await CloudBackup.uploadLargeMember(storage, job, member, data, remotePath, signal)
        }
      }

      const finalSources = await CloudBackup.getSources(job, manifest)
      job.members.forEach((member) => CloudBackup.getUnchangedSource(finalSources, member))
      const index: BackupIndex = {
        format: BACKUP_FORMAT,
        version: 1,
        projectTitle: job.projectTitle,
        createdAt: job.createdAt,
        members: job.members.map((member) => ({
          path: member.path,
          size: member.size,
          contentHash: job.uploaded[member.path],
        })),
      }
      const indexBytes = new TextEncoder().encode(JSON.stringify(index))
      const indexFile = { size: indexBytes.length, contentHash: await contentHash(indexBytes) }
      await storage.writeFile(`${job.folderPath}/${BACKUP_INDEX_NAME}`, indexBytes, indexFile, signal)
      await CloudBackup.deleteJobRecords()
      return CloudBackup.setStatus({ kind: 'complete', projectTitle: job.projectTitle })
    } catch (error) {
      if (signal.aborted) {
        // Cancelled: `cancel` removes the job and sets the status.
        return CloudBackup.status
      }
      return CloudBackup.handleFailure(storage, job, error)
    }
  }

  private static async uploadSmallMember(
    storage: CloudStorage,
    job: BackupJob,
    member: BackupJobMember,
    data: Blob,
    remotePath: string,
    signal: AbortSignal,
  ) {
    const bytes = new Uint8Array(await data.arrayBuffer())
    if (bytes.length != member.size) {
      throw new ProjectChangedError(`${member.path} changed size`)
    }
    const hash = await contentHash(bytes)
    await storage.writeFile(remotePath, bytes, { size: member.size, contentHash: hash }, signal)
    job.uploaded[member.path] = hash
    await CloudBackup.persist(job, signal)
  }

  /**
   * Uploads one chunk per request through a chunked upload that survives reloads. Each acknowledged chunk is persisted
   * with its block hashes, so a resumed upload neither resends nor rereads acknowledged bytes.
   */
  private static async uploadLargeMember(
    storage: CloudStorage,
    job: BackupJob,
    member: BackupJobMember,
    data: Blob,
    remotePath: string,
    signal: AbortSignal,
  ) {
    if (job.session?.path != member.path) {
      job.session = null
    }
    let restarted = false
    for (;;) {
      if (!job.session) {
        const state = await storage.startChunkedUpload(remotePath, signal)
        job.session = { path: member.path, offset: 0, blockHashes: [], state }
        await CloudBackup.persist(job, signal)
      }
      const session = job.session
      const offset = session.offset
      const end = Math.min(offset + UPLOAD_CHUNK_SIZE, member.size)
      const bytes = new Uint8Array(await data.slice(offset, end).arrayBuffer())
      if (bytes.length != end - offset) {
        throw new ProjectChangedError(`${member.path} changed size`)
      }
      const hasher = new ContentHasher()
      await hasher.update(bytes)
      const chunk = { offset, bytes, contentHash: await hasher.digest() }

      try {
        signal.throwIfAborted()
        if (end < member.size) {
          session.state = await storage.appendChunk(remotePath, session.state, chunk, signal)
          session.offset = end
          session.blockHashes.push(...hasher.blockHashes.map(toHex))
        } else {
          const hash = await new ContentHasher([...session.blockHashes.map(fromHex), ...hasher.blockHashes]).digest()
          await storage.finishChunkedUpload(
            remotePath,
            session.state,
            chunk,
            { size: member.size, contentHash: hash },
            signal,
          )
          job.uploaded[member.path] = hash
          job.session = null
          await CloudBackup.persist(job, signal)
          return
        }
      } catch (error) {
        if (!(error instanceof CloudUploadLostError) || restarted) {
          throw error
        }
        // The upload expired or diverged: upload this member again in a new one.
        restarted = true
        job.session = null
      }
      await CloudBackup.persist(job, signal)
    }
  }

  /** Discards the job's unfinished chunked upload and its folder, as far as the provider can be reached. */
  private static async discardUploads(job: BackupJob) {
    const storage = getCloudStorage(job.provider)
    if (job.session) {
      await storage
        .abortChunkedUpload(`${job.folderPath}/${job.session.path}`, job.session.state)
        .catch(() => undefined)
    }
    await storage.deleteFolder(job.folderPath).catch(() => undefined)
  }

  /** The current bytes of every member: the manifest as snapshotted, and the project's files as they are now. */
  private static async getSources(job: BackupJob, manifest: ManifestRecord): Promise<Map<string, Blob>> {
    const files = await FileSystemUtils.getDirectoryFiles(String(job.projectId))
    const sources = new Map(files.map((file) => [`${PROJECT_ARCHIVE_FILE_PREFIX}${file.path}`, file.data]))
    sources.set(PROJECT_ARCHIVE_MANIFEST_NAME, new Blob([manifest.data as Uint8Array<ArrayBuffer>]))
    return sources
  }

  private static getUnchangedSource(sources: ReadonlyMap<string, Blob>, member: BackupJobMember): Blob {
    const data = sources.get(member.path)
    if (!data || data.size != member.size || (data instanceof File ? data.lastModified : null) != member.lastModified) {
      throw new ProjectChangedError(`${member.path} changed`)
    }
    return data
  }

  private static async persist(job: BackupJob, signal: AbortSignal) {
    // A cancelled job must not write its record back after `cancel` deleted it.
    signal.throwIfAborted()
    await putRecord(job)
    CloudBackup.reportProgress(job)
  }

  private static async handleFailure(storage: CloudStorage, job: BackupJob, error: unknown): Promise<BackupStatus> {
    if (
      error instanceof ProjectChangedError ||
      (error instanceof DOMException && (error.name == 'NotFoundError' || error.name == 'NotReadableError'))
    ) {
      await CloudBackup.deleteJobRecords().catch(() => undefined)
      await CloudBackup.discardUploads(job)
      return CloudBackup.setStatus({
        kind: 'failed',
        projectTitle: job.projectTitle,
        message: `“${job.projectTitle}” changed during the backup. Back it up again.`,
      })
    }
    if (error instanceof CloudAuthorizationError) {
      return CloudBackup.pause(job, 'authorization', error.message)
    }
    if (error instanceof CloudUnavailableError) {
      return CloudBackup.pause(job, 'network', `${error.message} Check the connection, then resume the backup.`)
    }
    if (error instanceof CloudStorageFullError) {
      return CloudBackup.pause(
        job,
        'storage-full',
        `${error.message} Free space in ${storage.service}, then resume the backup.`,
      )
    }
    const service = error instanceof CloudError ? error.service : storage.service
    const reason = error instanceof CloudError ? error.reason : error instanceof Error ? error.message : String(error)
    return CloudBackup.pause(
      job,
      'error',
      `${service} rejected the backup (${reason}). Resume to retry or cancel the backup.`,
    )
  }

  private static pause(job: BackupJob, reason: BackupPauseReason, message: string): BackupStatus {
    return CloudBackup.setStatus({
      kind: 'paused',
      projectTitle: job.projectTitle,
      uploadedBytes: CloudBackup.getUploadedBytes(job),
      totalBytes: CloudBackup.getTotalBytes(job),
      reason,
      message,
    })
  }

  private static reportProgress(job: BackupJob) {
    CloudBackup.setStatus({
      kind: 'uploading',
      projectTitle: job.projectTitle,
      uploadedBytes: CloudBackup.getUploadedBytes(job),
      totalBytes: CloudBackup.getTotalBytes(job),
    })
  }

  private static getUploadedBytes(job: BackupJob): number {
    const uploaded = job.members.reduce((sum, member) => sum + (member.path in job.uploaded ? member.size : 0), 0)
    return uploaded + (job.session?.offset ?? 0)
  }

  private static getTotalBytes(job: BackupJob): number {
    return job.members.reduce((sum, member) => sum + member.size, 0)
  }

  private static setStatus(status: BackupStatus): BackupStatus {
    CloudBackup.status = status
    CloudBackup.listeners.forEach((listener) => listener(status))
    return status
  }

  private static async deleteJobRecords() {
    await deleteRecord(JOB_KEY)
    await deleteRecord(MANIFEST_KEY)
  }

  private static integrityError(path: string): Error {
    return new Error(`The backup file ${path} does not match its recorded size or content hash.`)
  }

  /** The folder's backup, or null when it has no valid index. */
  private static async readListing(storage: CloudStorage, folderPath: string): Promise<CloudBackupListing | null> {
    const stream = await storage.readFile(`${folderPath}/${BACKUP_INDEX_NAME}`)
    if (!stream) {
      return null
    }
    const reader = stream.getReader()
    const chunks = new Array<Uint8Array>()
    let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      size += value.length
      if (size > MAX_BACKUP_INDEX_SIZE) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
    let index: unknown
    try {
      index = JSON.parse(await new Blob(chunks as Uint8Array<ArrayBuffer>[]).text())
    } catch {
      return null
    }
    if (
      !isObjectRecord(index) ||
      index.format != BACKUP_FORMAT ||
      index.version != 1 ||
      typeof index.projectTitle != 'string' ||
      typeof index.createdAt != 'string' ||
      !Array.isArray(index.members)
    ) {
      return null
    }
    const members = new Array<CloudBackupMember>()
    for (const member of index.members) {
      if (
        !isObjectRecord(member) ||
        typeof member.path != 'string' ||
        typeof member.size != 'number' ||
        !Number.isSafeInteger(member.size) ||
        member.size < 0 ||
        typeof member.contentHash != 'string'
      ) {
        return null
      }
      members.push({ path: member.path, size: member.size, contentHash: member.contentHash })
    }
    if (!members.some((member) => member.path == PROJECT_ARCHIVE_MANIFEST_NAME)) {
      return null
    }
    return {
      provider: storage.provider,
      folderPath,
      projectTitle: index.projectTitle,
      createdAt: index.createdAt,
      totalBytes: members.reduce((sum, member) => sum + member.size, 0),
      members,
    }
  }
}
