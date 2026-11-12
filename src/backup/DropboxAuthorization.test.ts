import 'fake-indexeddb/auto'
import { afterEach, expect, test, vi } from 'vitest'
import { connect, isConnected, prepareAuthorization } from './DropboxAuthorization'
import { DROPBOX_AUTHORIZATION_CHANNEL, type DropboxAuthorizationResult } from './DropboxAuthorizationMessages'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

test('connecting rejects a token that lacks the scopes backups need, naming them', async () => {
  vi.stubEnv('VITE_DROPBOX_APP_KEY', 'app-key')
  vi.stubGlobal('location', { origin: 'https://localhost:8443' })
  vi.stubGlobal('window', { open: vi.fn() })
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        access_token: 'token',
        token_type: 'bearer',
        expires_in: 14_400,
        scope: 'account_info.read files.metadata.read',
        account_id: 'dbid:account',
      }),
    ),
  )
  const prepared = await prepareAuthorization()

  const connecting = connect(prepared)
  const callbackPage = new BroadcastChannel(DROPBOX_AUTHORIZATION_CHANNEL)
  const result: DropboxAuthorizationResult = {
    type: 'authorization-result',
    state: prepared.state,
    code: 'code',
    error: null,
    errorDescription: null,
  }
  callbackPage.postMessage(result)

  await expect(connecting).rejects.toThrow(
    "SoundEtch's Dropbox app lacks the “files.content.read”, “files.content.write” permissions.",
  )
  callbackPage.close()
  expect(await isConnected()).toBe(false)
})
