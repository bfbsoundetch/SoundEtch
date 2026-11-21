import { toHex } from './ContentHasher'

export interface S3Credentials {
  readonly accessKeyId: string
  readonly secretAccessKey: string
  readonly region: string
}

export interface S3SignedRequest {
  readonly method: string
  /** The request's `Host` header, which browsers derive from the URL. */
  readonly host: string
  /** The absolute path, already encoded by `encodeS3Path`. */
  readonly path: string
  /** The query, already built by `canonicalQuery`. */
  readonly query: string
  /** Further headers to sign, with lowercase names; `host` is added. */
  readonly headers: Readonly<Record<string, string>>
  /** Hex SHA-256 of the body, so S3 rejects a body that does not match it. */
  readonly payloadHash: string
}

const encoder = new TextEncoder()

/** Hex SHA-256 of `bytes`. */
export async function sha256Hex(bytes: Uint8Array<ArrayBuffer> | string): Promise<string> {
  const data = typeof bytes == 'string' ? encoder.encode(bytes) : bytes
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', data)))
}

/** AWS's URI encoding: every byte but `A-Za-z0-9-._~` as uppercase `%XX`; `/` only when `encodeSlash`. */
export function uriEncode(value: string, encodeSlash: boolean): string {
  let result = ''
  for (const byte of encoder.encode(value)) {
    const character = String.fromCharCode(byte)
    if (/[A-Za-z0-9\-._~]/.test(character) || (character == '/' && !encodeSlash)) {
      result += character
    } else {
      result += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
    }
  }
  return result
}

/** The path of `/`-separated `segments`, encoded for both the request URL and its signature. */
export function encodeS3Path(...segments: string[]): string {
  return `/${segments.map((segment) => uriEncode(segment, false)).join('/')}`
}

/** The query of `parameters`, sorted and encoded for both the request URL and its signature. */
export function canonicalQuery(parameters: ReadonlyArray<readonly [string, string]>): string {
  return parameters
    .map(([name, value]) => [uriEncode(name, true), uriEncode(value, true)] as const)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join('&')
}

/** `date` in ISO 8601 basic format, as `x-amz-date` takes it. */
export function amzDate(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
}

/**
 * The `Authorization` header of AWS Signature Version 4 for `request`, made at `date`. `request.headers` must hold the
 * `x-amz-date` and `x-amz-content-sha256` headers that will be sent.
 * https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html
 */
export async function signS3Request(request: S3SignedRequest, credentials: S3Credentials, date: Date) {
  const headers = new Map(Object.entries({ ...request.headers, host: request.host }).map(([n, v]) => [n, v.trim()]))
  const names = [...headers.keys()].sort()
  const signedHeaders = names.join(';')
  const canonicalHeaders = names.map((name) => `${name}:${headers.get(name)}`)
  const canonicalRequest = [request.method, request.path, request.query, ...canonicalHeaders, '', signedHeaders]
  const { scope, signature } = await sign([...canonicalRequest, request.payloadHash], credentials, date)
  return `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
}

export interface S3PresignedRequest {
  readonly method: string
  /** `https:` unless given; a custom endpoint may be plain HTTP. */
  readonly protocol?: string
  readonly host: string
  /** The absolute path, already encoded by `encodeS3Path`. */
  readonly path: string
  /** Further query parameters, unencoded. */
  readonly query: ReadonlyArray<readonly [string, string]>
}

/**
 * A URL that makes `request` without credentials until `seconds` after `date`. Only `host` is signed and the payload is
 * not, so the URL takes any body.
 * https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
 */
export async function presignS3Url(
  request: S3PresignedRequest,
  credentials: S3Credentials,
  date: Date,
  seconds: number,
): Promise<string> {
  const timestamp = amzDate(date)
  const query = canonicalQuery([
    ...request.query,
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${credentials.accessKeyId}/${credentialScope(timestamp, credentials)}`],
    ['X-Amz-Date', timestamp],
    ['X-Amz-Expires', String(seconds)],
    ['X-Amz-SignedHeaders', 'host'],
  ])
  const canonicalRequest = [request.method, request.path, query, `host:${request.host}`, '', 'host', 'UNSIGNED-PAYLOAD']
  const { signature } = await sign(canonicalRequest, credentials, date)
  return `${request.protocol ?? 'https:'}//${request.host}${request.path}?${query}&X-Amz-Signature=${signature}`
}

function credentialScope(timestamp: string, credentials: S3Credentials): string {
  return `${timestamp.slice(0, 8)}/${credentials.region}/s3/aws4_request`
}

/** The signature of the canonical request made of `lines`, and its credential scope. */
async function sign(lines: readonly string[], credentials: S3Credentials, date: Date) {
  const timestamp = amzDate(date)
  const day = timestamp.slice(0, 8)
  const scope = credentialScope(timestamp, credentials)
  const stringToSign = ['AWS4-HMAC-SHA256', timestamp, scope, await sha256Hex(lines.join('\n'))].join('\n')
  let key: Uint8Array<ArrayBuffer> = encoder.encode(`AWS4${credentials.secretAccessKey}`)
  for (const part of [day, credentials.region, 's3', 'aws4_request']) {
    key = await hmac(key, part)
  }
  return { scope, signature: toHex(await hmac(key, stringToSign)) }
}

async function hmac(key: Uint8Array<ArrayBuffer>, message: string): Promise<Uint8Array<ArrayBuffer>> {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message)))
}
