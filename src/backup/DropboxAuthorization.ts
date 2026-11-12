import { deleteRecord, getRecord, putRecord } from './BackupStore'
import {
  DROPBOX_AUTHORIZATION_CHANNEL,
  type DropboxAuthorizationReceived,
  type DropboxAuthorizationResult,
} from './DropboxAuthorizationMessages'

export interface PreparedAuthorization {
  readonly url: string
  readonly state: string
  readonly verifier: string
}

interface TokenRecord {
  readonly key: 'token'
  readonly accessToken: string
  readonly expiresAt: number
  readonly accountId: string
}

const TOKEN_KEY = 'token'
/** Tokens this close to expiry are treated as expired, so a request never starts with one. */
const EXPIRY_MARGIN = 2 * 60_000
/** The scopes backup and restore use; the Dropbox app must have every one enabled. */
const REQUIRED_SCOPES: readonly string[] = ['files.metadata.read', 'files.content.read', 'files.content.write']

export class DropboxAuthorizationError extends Error {
  override name = 'DropboxAuthorizationError'
}

/**
 * The token lacks scopes: the Dropbox app does not have them enabled, or did not when the user authorized it. A token
 * never gains scopes, so the user must reconnect once the app has them.
 */
export class DropboxPermissionError extends DropboxAuthorizationError {
  override name = 'DropboxPermissionError'

  constructor(readonly scopes: readonly string[]) {
    const names = scopes.map((scope) => `“${scope}”`).join(', ')
    super(
      scopes.length == 1
        ? `SoundEtch's Dropbox app lacks the ${names} permission. Enable it on the app's Permissions tab in the Dropbox App Console, then reconnect Dropbox.`
        : `SoundEtch's Dropbox app lacks the ${names} permissions. Enable them on the app's Permissions tab in the Dropbox App Console, then reconnect Dropbox.`,
    )
  }
}

/** The Dropbox app key; the Dropbox feature is enabled iff it is configured. */
export function appKey(): string | null {
  return import.meta.env.VITE_DROPBOX_APP_KEY?.trim() || null
}

export function redirectUri(): string {
  const basePath = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`
  return new URL('dropbox-auth.html', new URL(basePath, location.origin)).href
}

/** Computed ahead of the click, so `connect` can open the authorization tab before any `await`. */
export async function prepareAuthorization(): Promise<PreparedAuthorization> {
  const clientId = requireAppKey()
  // 32 random bytes encode to the 43-character verifier.
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)))
  const challenge = base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
  const state = base64Url(crypto.getRandomValues(new Uint8Array(16)))
  const url = new URL('https://www.dropbox.com/oauth2/authorize')
  url.search = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    redirect_uri: redirectUri(),
    state,
    token_access_type: 'online',
  }).toString()
  return { url: url.href, state, verifier }
}

let connectGeneration = 0
let cancelPendingConnect: (() => void) | null = null

/**
 * Opens Dropbox's authorization page in a new tab and stores the token once the callback page relays the code. Must be
 * called synchronously from a click handler. A later call supersedes this one, which then rejects with `AbortError`.
 */
export function connect(prepared: PreparedAuthorization): Promise<void> {
  // Before any await, so the new tab keeps the click's user activation.
  window.open(prepared.url, '_blank', 'noopener')
  cancelPendingConnect?.()
  const generation = ++connectGeneration
  const channel = new BroadcastChannel(DROPBOX_AUTHORIZATION_CHANNEL)
  return new Promise<void>((resolve, reject) => {
    cancelPendingConnect = () => {
      channel.onmessage = null
      reject(new DOMException('A newer Dropbox connection attempt replaced this one.', 'AbortError'))
    }
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const result = event.data as Partial<DropboxAuthorizationResult> | null
      if (result?.type != 'authorization-result' || result.state != prepared.state) {
        return
      }
      channel.onmessage = null
      if (generation == connectGeneration) {
        cancelPendingConnect = null
      }
      const received: DropboxAuthorizationReceived = { type: 'authorization-received', state: prepared.state }
      channel.postMessage(received)
      if (result.error) {
        reject(new Error(`Dropbox authorization failed: ${result.errorDescription ?? result.error}`))
        return
      }
      if (!result.code) {
        reject(new Error('Dropbox authorization failed: no authorization code was returned.'))
        return
      }
      exchangeCode(result.code, prepared.verifier).then(resolve, reject)
    }
  }).finally(() => channel.close())
}

async function exchangeCode(code: string, verifier: string): Promise<void> {
  const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    body: new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      code_verifier: verifier,
      client_id: requireAppKey(),
      redirect_uri: redirectUri(),
    }),
  })
  const body: unknown = await response.json().catch(() => null)
  const fields = (typeof body == 'object' && body ? body : {}) as Record<string, unknown>
  if (!response.ok || typeof fields.access_token != 'string' || typeof fields.expires_in != 'number') {
    const reason = fields.error_description ?? fields.error ?? `HTTP ${response.status}`
    throw new Error(`Dropbox authorization failed: ${String(reason)}`)
  }
  // Dropbox grants the scopes the app has enabled when the user authorizes it.
  if (typeof fields.scope == 'string') {
    const granted = new Set(fields.scope.split(' '))
    const missing = REQUIRED_SCOPES.filter((scope) => !granted.has(scope))
    if (missing.length > 0) {
      throw new DropboxPermissionError(missing)
    }
  }
  const token: TokenRecord = {
    key: TOKEN_KEY,
    accessToken: fields.access_token,
    expiresAt: Date.now() + fields.expires_in * 1000,
    accountId: String(fields.account_id ?? ''),
  }
  await putRecord(token)
}

export async function getAccessToken(): Promise<string> {
  const token = await getRecord<TokenRecord>(TOKEN_KEY)
  if (token && token.expiresAt - Date.now() > EXPIRY_MARGIN) {
    return token.accessToken
  }
  throw new DropboxAuthorizationError('Dropbox authorization expired. Reconnect Dropbox to continue.')
}

export async function isConnected(): Promise<boolean> {
  const token = await getRecord<TokenRecord>(TOKEN_KEY)
  return token != null && token.expiresAt - Date.now() > EXPIRY_MARGIN
}

export async function clearToken(): Promise<void> {
  await deleteRecord(TOKEN_KEY)
}

/** Revokes the token if Dropbox can be reached, and forgets it regardless. */
export async function disconnect(): Promise<void> {
  try {
    const token = await getRecord<TokenRecord>(TOKEN_KEY)
    if (token) {
      await fetch('https://api.dropboxapi.com/2/auth/token/revoke', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token.accessToken}` },
      })
    }
  } catch {
    // The token expires within hours anyway.
  }
  await clearToken()
}

function requireAppKey(): string {
  const key = appKey()
  if (!key) {
    throw new Error('Dropbox is not configured for this build.')
  }
  return key
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}
