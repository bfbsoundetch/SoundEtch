// No imports: the authorization callback page loads this without the editor's modules.

export const DROPBOX_AUTHORIZATION_CHANNEL = 'soundetch-dropbox-authorization'

/** Sent by the callback page with the redirect's query parameters. */
export type DropboxAuthorizationResult = {
  type: 'authorization-result'
  state: string | null
  code: string | null
  error: string | null
  errorDescription: string | null
}

/** Sent by the editor once it has taken the result whose `state` it was waiting for. */
export type DropboxAuthorizationReceived = {
  type: 'authorization-received'
  state: string
}
