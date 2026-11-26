import { getRecord, putRecord } from './BackupStore'
import {
  CloudAuthorizationError,
  CloudError,
  CloudUnavailableError,
  CloudUploadLostError,
  retryAfterHeaderSeconds,
  waitBeforeRetry,
  type ChunkedUploadState,
  type CloudFile,
  type CloudStorage,
  type StoredFile,
  type UploadChunk,
  type UploadLink,
} from './CloudStorage'
import { amzDate, canonicalQuery, encodeS3Path, presignS3Url, sha256Hex, signS3Request } from './S3Signer'

/** Where backups go in an S3-compatible service: Amazon S3, Cloudflare R2, Backblaze B2, MinIO, and others. */
export interface S3Settings {
  /** The service's origin, e.g. `https://s3.us-east-1.amazonaws.com`. */
  readonly endpoint: string
  readonly region: string
  readonly bucket: string
  /** Prepended to every key: empty, or ending in `/`. */
  readonly prefix: string
  readonly accessKeyId: string
  /** `endpoint/bucket/key` URLs instead of `bucket.endpoint/key`. */
  readonly pathStyle: boolean
}

interface S3Config extends S3Settings {
  readonly secretAccessKey: string
}

interface S3Record extends S3Settings {
  readonly key: typeof SETTINGS_KEY
  /** Null once disconnected or refused; the other settings stay to fill in the form. */
  readonly secretAccessKey: string | null
}

interface UploadState extends ChunkedUploadState {
  readonly uploadId: string
  /** The ETag of each stored part, in part order. */
  readonly etags: readonly string[]
}

interface RequestOptions {
  readonly query?: ReadonlyArray<readonly [string, string]>
  readonly body?: Uint8Array<ArrayBuffer>
  readonly signal?: AbortSignal
  /** False to fail on the first network error or transient failure, as a connection check should. */
  readonly retry?: boolean
  /** The operation can answer 200 with an `<Error>` body, as CompleteMultipartUpload does. */
  readonly bodyMayHoldError?: boolean
}

const SETTINGS_KEY = 's3-settings'
const SERVICE = 'S3'
const EMPTY = new Uint8Array()
const DELETE_CONCURRENCY = 4
/** The longest a presigned URL may last: 7 days. */
const MAX_UPLOAD_LINK_SECONDS = 604800
/** Written and deleted again by the connection check. */
const CHECK_NAME = '.soundetch-connection-check'
const ETAG_HIDDEN = "the bucket's CORS rules do not expose the ETag header, which uploads need"
const AUTHORIZATION_CODES: readonly string[] = [
  'AccessDenied',
  'AccountProblem',
  'AllAccessDisabled',
  'ExpiredToken',
  'InvalidAccessKeyId',
  'InvalidToken',
  'SignatureDoesNotMatch',
]
const TRANSIENT_CODES: readonly string[] = [
  'BadDigest',
  'InternalError',
  'OperationAborted',
  'RequestTimeout',
  'ServiceUnavailable',
  'SlowDown',
  'XAmzContentSHA256Mismatch',
]

/** S3 rejected a request with error `code`. */
export class S3Error extends CloudError {
  override name = 'S3Error'

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(SERVICE, message ? `${code}: ${message}` : code)
  }
}

/** The stored settings, with or without a secret. */
export async function getS3Settings(): Promise<S3Settings | null> {
  const record = await getRecord<S3Record>(SETTINGS_KEY)
  if (!record) {
    return null
  }
  const { key: _key, secretAccessKey: _secret, ...settings } = record
  return settings
}

export async function isS3Connected(): Promise<boolean> {
  return (await getRecord<S3Record>(SETTINGS_KEY))?.secretAccessKey != null
}

/**
 * Checks that the key can list, write, and delete in the bucket through its CORS rules, then stores the settings and the
 * secret. The settings are stored even when the check fails, so the form keeps them.
 */
export async function connectS3(input: S3Settings, secretAccessKey: string): Promise<S3Settings> {
  const settings = normalizeS3Settings(input)
  const secret = secretAccessKey.trim()
  if (!secret) {
    throw new Error('Enter the secret access key.')
  }
  await putRecord<S3Record>({ key: SETTINGS_KEY, ...settings, secretAccessKey: null })
  await new S3Storage({ ...settings, secretAccessKey: secret }).checkAccess()
  await putRecord<S3Record>({ key: SETTINGS_KEY, ...settings, secretAccessKey: secret })
  return settings
}

/** Forgets the secret; the other settings stay to fill in the form. */
export async function disconnectS3(): Promise<void> {
  const record = await getRecord<S3Record>(SETTINGS_KEY)
  if (record?.secretAccessKey != null) {
    await putRecord<S3Record>({ ...record, secretAccessKey: null })
  }
}

/** Trims and validates `input`; an empty endpoint means Amazon S3 in the region. */
export function normalizeS3Settings(input: S3Settings): S3Settings {
  const region = input.region.trim()
  const bucket = input.bucket.trim()
  const accessKeyId = input.accessKeyId.trim()
  if (!region) {
    throw new Error('Enter the region, e.g. us-east-1, or auto for Cloudflare R2.')
  }
  if (!bucket || bucket.includes('/')) {
    throw new Error('Enter the bucket name.')
  }
  if (!accessKeyId) {
    throw new Error('Enter the access key ID.')
  }
  let endpoint: URL
  try {
    endpoint = new URL(input.endpoint.trim() || `https://s3.${region}.amazonaws.com`)
  } catch {
    throw new Error('The endpoint must be a URL such as https://s3.us-east-1.amazonaws.com.')
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)
  if (endpoint.protocol != 'https:' && !(endpoint.protocol == 'http:' && loopback)) {
    throw new Error('The endpoint must use https.')
  }
  if (endpoint.pathname != '/' || endpoint.search || endpoint.username) {
    throw new Error('Enter the endpoint without a path; the bucket has its own field.')
  }
  const prefix = input.prefix.trim().replace(/^\/+/, '')
  return {
    endpoint: endpoint.origin,
    region,
    bucket,
    prefix: prefix && !prefix.endsWith('/') ? `${prefix}/` : prefix,
    accessKeyId,
    pathStyle: input.pathStyle,
  }
}

/**
 * A bucket, or the part of it under the settings' prefix. Requests are signed with AWS Signature Version 4 over their
 * payload hash, so S3 rejects any body that differs from what was hashed; chunked uploads are multipart uploads.
 */
export class S3Storage implements CloudStorage {
  readonly provider = 's3'
  readonly service = SERVICE

  /** `config` is used instead of the stored settings, for checking them before they are stored. */
  constructor(private readonly config: S3Config | null = null) {}

  async listFolders(signal?: AbortSignal): Promise<string[]> {
    const config = await this.getConfig()
    const { prefixes } = await this.list(config, config.prefix, true, { signal })
    return prefixes.map((prefix) => `/${prefix.slice(config.prefix.length, -1)}`)
  }

  async readFile(path: string, signal?: AbortSignal): Promise<ReadableStream<Uint8Array> | null> {
    const config = await this.getConfig()
    try {
      const response = await this.request(config, 'GET', objectKey(config, path), { signal })
      return response.body ?? new Blob().stream()
    } catch (error) {
      if (error instanceof S3Error && (error.code == 'NoSuchKey' || error.code == 'NotFound')) {
        return null
      }
      throw error
    }
  }

  async writeFile(path: string, bytes: Uint8Array<ArrayBuffer>, _expected: StoredFile, signal?: AbortSignal) {
    const config = await this.getConfig()
    await this.request(config, 'PUT', objectKey(config, path), { body: bytes, signal })
  }

  async startChunkedUpload(path: string, signal?: AbortSignal): Promise<UploadState> {
    const config = await this.getConfig()
    const response = await this.request(config, 'POST', objectKey(config, path), { query: [['uploads', '']], signal })
    const uploadId = xmlValue(await response.text(), 'UploadId')
    if (!uploadId) {
      throw new S3Error(response.status, 'MalformedResponse', 'CreateMultipartUpload returned no upload ID')
    }
    return { uploadId, etags: [] }
  }

  async appendChunk(path: string, state: ChunkedUploadState, chunk: UploadChunk, signal?: AbortSignal) {
    const { uploadId, etags } = state as UploadState
    const config = await this.getConfig()
    // A chunk sent again after a lost response has the same part number and replaces the earlier part.
    const etag = await this.uploadPart(config, objectKey(config, path), uploadId, etags.length + 1, chunk, signal)
    return { uploadId, etags: [...etags, etag] }
  }

  async finishChunkedUpload(
    path: string,
    state: ChunkedUploadState,
    chunk: UploadChunk,
    expected: StoredFile,
    signal?: AbortSignal,
  ) {
    const { uploadId, etags } = state as UploadState
    const config = await this.getConfig()
    const key = objectKey(config, path)
    const parts = [...etags]
    if (chunk.bytes.length > 0 || parts.length == 0) {
      parts.push(await this.uploadPart(config, key, uploadId, parts.length + 1, chunk, signal))
    }
    // ETags are quoted hex strings; only `&` and `<` would need escaping in element text.
    const partList = parts.map(
      (etag, index) =>
        `<Part><PartNumber>${index + 1}</PartNumber><ETag>${etag.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</ETag></Part>`,
    )
    const body = new TextEncoder().encode(`<CompleteMultipartUpload>${partList.join('')}</CompleteMultipartUpload>`)
    try {
      await this.request(config, 'POST', key, { query: [['uploadId', uploadId]], body, signal, bodyMayHoldError: true })
    } catch (error) {
      if (!(error instanceof S3Error && error.code == 'NoSuchUpload')) {
        throw error
      }
      // An earlier completion may have succeeded with its response lost.
      if ((await this.getSize(config, key, signal)) != expected.size) {
        throw new CloudUploadLostError()
      }
    }
  }

  async abortChunkedUpload(path: string, state: ChunkedUploadState, signal?: AbortSignal): Promise<void> {
    const config = await this.getConfig()
    const { uploadId } = state as UploadState
    try {
      await this.request(config, 'DELETE', objectKey(config, path), { query: [['uploadId', uploadId]], signal })
    } catch (error) {
      if (!(error instanceof S3Error && error.code == 'NoSuchUpload')) {
        throw error
      }
    }
  }

  async deleteFolder(path: string, signal?: AbortSignal): Promise<void> {
    const config = await this.getConfig()
    const keys = (await this.list(config, `${objectKey(config, path)}/`, false, { signal })).objects.map((o) => o.key)
    let next = 0
    const deleteNext = async () => {
      while (next < keys.length) {
        await this.request(config, 'DELETE', keys[next++], { signal })
      }
    }
    await Promise.all(Array.from({ length: Math.min(DELETE_CONCURRENCY, keys.length) }, deleteNext))
  }

  async createUploadLink(path: string, seconds: number): Promise<UploadLink> {
    const config = await this.getConfig()
    const location = requestLocation(config, objectKey(config, path))
    const expires = Math.min(seconds, MAX_UPLOAD_LINK_SECONDS)
    const url = await presignS3Url({ method: 'PUT', ...location, query: [] }, config, new Date(), expires)
    return { method: 'PUT', url, singleUse: false }
  }

  async listFiles(folder: string, signal?: AbortSignal): Promise<CloudFile[] | null> {
    const config = await this.getConfig()
    const prefix = `${objectKey(config, folder)}/`
    const { objects } = await this.list(config, prefix, true, { signal })
    // A console-made folder is an empty object named like the prefix; it is not a file.
    const files = objects
      .filter(({ key }) => key != prefix)
      .map(({ key, size }) => ({ name: key.slice(prefix.length), size, contentHash: null }))
    return files.length == 0 ? null : files
  }

  /** Lists, writes, and deletes a small file, failing fast with what to fix. */
  async checkAccess(): Promise<void> {
    const config = await this.getConfig()
    const key = `${config.prefix}${CHECK_NAME}`
    await this.list(config, config.prefix, true, { retry: false }).catch(async (error: unknown) => {
      throw error instanceof CloudUnavailableError ? new Error(await this.explainBlockedList(config)) : error
    })
    const response = await this.request(config, 'PUT', key, {
      body: new TextEncoder().encode('ok'),
      retry: false,
    }).catch(
      blockedAs(
        `The key can list the bucket, but writing ${CHECK_NAME} there was blocked. Check that the key can write objects (Object Read & Write, for a Cloudflare R2 token) and that the bucket's CORS rules allow PUT.`,
      ),
    )
    await this.request(config, 'DELETE', key, { retry: false }).catch(
      blockedAs(
        `The key can list and write in the bucket, but deleting ${CHECK_NAME} was blocked, so it is still there. Check that the key can delete objects and that the bucket's CORS rules allow DELETE.`,
      ),
    )
    if (!response.headers.has('ETag')) {
      throw new Error(`The key works, but ${ETAG_HIDDEN}. Add ETag to the bucket's exposed CORS headers.`)
    }
  }

  /**
   * What to fix when listing the bucket got no readable response. The browser hides any response that the bucket's
   * CORS rules do not allow, and Cloudflare R2 leaves the CORS headers off every error, so a refused key or a missing
   * bucket looks the same as missing rules. A list signed in its query sends no headers, so it skips the CORS
   * preflight: when its response is readable, the rules allow this origin but not the signed request's method or
   * headers.
   */
  private async explainBlockedList(config: S3Config): Promise<string> {
    const origin = globalThis.location?.origin ?? 'this site'
    const { protocol, host, path } = requestLocation(config, null)
    const query: Array<[string, string]> = [
      ['list-type', '2'],
      ['max-keys', '1'],
      ['prefix', config.prefix],
    ]
    const url = await presignS3Url({ method: 'GET', protocol, host, path, query }, config, new Date(), 60)
    try {
      await fetch(url, { credentials: 'omit', cache: 'no-store' })
      return `The bucket's CORS rules allow ${origin}, but not the methods or headers of SoundEtch's requests. Set AllowedMethods to GET, PUT, POST, DELETE, and HEAD, and AllowedHeaders to ["*"].`
    } catch (error) {
      if (!(error instanceof TypeError)) {
        throw error
      }
    }
    return `No readable response from ${host}. Check the access key ID and secret access key (Cloudflare R2 answers a wrong key this way), the bucket name, the endpoint and region, and that the bucket's CORS rules allow ${origin}.`
  }

  private async getConfig(): Promise<S3Config> {
    if (this.config) {
      return this.config
    }
    const record = await getRecord<S3Record>(SETTINGS_KEY)
    if (record?.secretAccessKey == null) {
      throw new CloudAuthorizationError('S3 is not connected. Connect it to continue.')
    }
    const { key: _key, ...config } = record
    return { ...config, secretAccessKey: record.secretAccessKey }
  }

  private async uploadPart(
    config: S3Config,
    key: string,
    uploadId: string,
    partNumber: number,
    chunk: UploadChunk,
    signal?: AbortSignal,
  ): Promise<string> {
    let response: Response
    try {
      response = await this.request(config, 'PUT', key, {
        query: [
          ['partNumber', String(partNumber)],
          ['uploadId', uploadId],
        ],
        body: chunk.bytes,
        signal,
      })
    } catch (error) {
      throw error instanceof S3Error && error.code == 'NoSuchUpload' ? new CloudUploadLostError() : error
    }
    const etag = response.headers.get('ETag')
    if (!etag) {
      throw new CloudError(SERVICE, ETAG_HIDDEN)
    }
    return etag
  }

  /** The object's size, or null when there is no object. */
  private async getSize(config: S3Config, key: string, signal?: AbortSignal): Promise<number | null> {
    try {
      const response = await this.request(config, 'HEAD', key, { signal })
      return Number(response.headers.get('Content-Length'))
    } catch (error) {
      if (error instanceof S3Error && error.code == 'NotFound') {
        return null
      }
      throw error
    }
  }

  /** Objects under `prefix`, and with `foldersOnly`, only those directly in it plus the `prefix…/` folders in it. */
  private async list(config: S3Config, prefix: string, foldersOnly: boolean, options: RequestOptions) {
    const objects = new Array<{ key: string; size: number }>()
    const prefixes = new Array<string>()
    let token: string | null = null
    do {
      const query: Array<[string, string]> = [
        ['list-type', '2'],
        ['prefix', prefix],
      ]
      if (foldersOnly) query.push(['delimiter', '/'])
      if (token) query.push(['continuation-token', token])
      const xml = await (await this.request(config, 'GET', null, { ...options, query })).text()
      for (const contents of xmlElements(xml, 'Contents')) {
        const key = xmlValue(contents, 'Key')
        if (key != null) objects.push({ key, size: Number(xmlValue(contents, 'Size') ?? 0) })
      }
      for (const commonPrefix of xmlElements(xml, 'CommonPrefixes')) {
        const value = xmlValue(commonPrefix, 'Prefix')
        if (value) prefixes.push(value)
      }
      token = xmlValue(xml, 'IsTruncated') == 'true' ? xmlValue(xml, 'NextContinuationToken') : null
    } while (token)
    return { objects, prefixes }
  }

  /** Sends one signed request for the object `key`, or the bucket when null; retries transient failures. */
  private async request(config: S3Config, method: string, key: string | null, options: RequestOptions) {
    const { protocol, host, path } = requestLocation(config, key)
    const query = canonicalQuery(options.query ?? [])
    const url = `${protocol}//${host}${path}${query ? `?${query}` : ''}`
    const payloadHash = await sha256Hex(options.body ?? EMPTY)
    for (let attempt = 1; ; ++attempt) {
      options.signal?.throwIfAborted()
      const now = new Date()
      const headers = { 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate(now) }
      const authorization = await signS3Request({ method, host, path, query, headers, payloadHash }, config, now)
      let response: Response
      try {
        response = await fetch(url, {
          method,
          headers: { ...headers, Authorization: authorization },
          body: options.body,
          signal: options.signal,
          credentials: 'omit',
          cache: 'no-store',
        })
      } catch (error) {
        // Network and CORS failures are TypeErrors; an abort is a DOMException and ends the request.
        if (!(error instanceof TypeError)) {
          throw error
        }
        if (options.retry === false) {
          throw new CloudUnavailableError(SERVICE)
        }
        await waitBeforeRetry(SERVICE, attempt, null, options.signal)
        continue
      }
      let text: string | null = null
      if (response.ok) {
        if (!options.bodyMayHoldError) {
          return response
        }
        text = await response.text()
        if (!/<Error>/.test(text)) {
          return new Response(text, { status: response.status, headers: response.headers })
        }
      }
      text ??= await response.text()
      const code = xmlValue(text, 'Code') ?? (response.status == 404 ? 'NotFound' : `HTTP ${response.status}`)
      const message = xmlValue(text, 'Message') ?? ''
      if (AUTHORIZATION_CODES.includes(code) || (response.status == 403 && !text)) {
        if (!this.config) {
          await disconnectS3()
        }
        throw new CloudAuthorizationError(
          `S3 refused the access key (${message ? `${code}: ${message}` : code}). Connect S3 with a key that can list, read, write, and delete in the bucket.`,
        )
      }
      const transient = response.status == 429 || response.status >= 500 || TRANSIENT_CODES.includes(code)
      if (transient && options.retry !== false) {
        await waitBeforeRetry(SERVICE, attempt, retryAfterHeaderSeconds(response), options.signal)
        continue
      }
      throw new S3Error(response.status, code, message)
    }
  }
}

/** Where requests for the object `key`, or the bucket when null, go. */
function requestLocation(config: S3Settings, key: string | null) {
  const endpoint = new URL(config.endpoint)
  const host = config.pathStyle ? endpoint.host : `${config.bucket}.${endpoint.host}`
  const segments = [...(config.pathStyle ? [config.bucket] : []), ...(key == null ? [] : [key])]
  return { protocol: endpoint.protocol, host, path: encodeS3Path(...segments) }
}

function objectKey(config: S3Settings, path: string): string {
  return `${config.prefix}${path.replace(/^\//, '')}`
}

/** Rethrows a request's error, or `message` when the request got no readable response. */
function blockedAs(message: string): (error: unknown) => never {
  return (error) => {
    throw error instanceof CloudUnavailableError ? new Error(message) : error
  }
}

/** The contents of each `<tag>` element; S3's responses never nest an element in one of the same name. */
function xmlElements(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g'))].map((match) => match[1])
}

/** The decoded text of the first `<tag>` element. */
function xmlValue(xml: string, tag: string): string | null {
  const contents = xmlElements(xml, tag)[0]
  return contents == null ? null : decodeXml(contents)
}

const XML_ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi, (_, entity: string) =>
    entity[0] == '#'
      ? String.fromCodePoint(
          entity[1] == 'x' || entity[1] == 'X' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1)),
        )
      : XML_ENTITIES[entity.toLowerCase()],
  )
}
