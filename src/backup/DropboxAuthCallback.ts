import {
  DROPBOX_AUTHORIZATION_CHANNEL,
  type DropboxAuthorizationReceived,
  type DropboxAuthorizationResult,
} from './DropboxAuthorizationMessages'

/** How long the editor has to acknowledge the result before this page says it was lost. */
const RECEIPT_TIMEOUT = 5000

const parameters = new URLSearchParams(location.search)
const result: DropboxAuthorizationResult = {
  type: 'authorization-result',
  state: parameters.get('state'),
  code: parameters.get('code'),
  error: parameters.get('error'),
  errorDescription: parameters.get('error_description'),
}
// Keeps the single-use code out of the history and any later copy of the address.
history.replaceState(null, '', location.pathname)

const message = document.getElementById('dropbox-auth-message')!
const channel = new BroadcastChannel(DROPBOX_AUTHORIZATION_CHANNEL)

if (result.error) {
  channel.postMessage(result)
  channel.close()
  message.textContent = `Dropbox authorization failed: ${result.errorDescription ?? result.error}`
} else {
  const timeout = setTimeout(() => {
    channel.close()
    message.textContent =
      'SoundEtch did not receive this authorization. Return to SoundEtch and choose Connect Dropbox again.'
  }, RECEIPT_TIMEOUT)
  channel.onmessage = (event: MessageEvent<unknown>) => {
    const reply = event.data as Partial<DropboxAuthorizationReceived> | null
    if (reply?.type != 'authorization-received' || reply.state != result.state) {
      return
    }
    clearTimeout(timeout)
    channel.close()
    message.textContent = 'Dropbox is connected. You can close this tab.'
    window.close()
  }
  channel.postMessage(result)
}
