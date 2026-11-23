const MAX_MESSAGE_LENGTH = 4000
const MAX_LOG_BYTES = 65536
const TOKEN_LIFETIME_MS = 300000
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

const form = document.getElementById('feedback-form')
const draftFields = document.getElementById('draft-fields')
const message = document.getElementById('message')
const messageError = document.getElementById('message-error')
const logsPreview = document.getElementById('logs-preview')
const logsSize = document.getElementById('logs-size')
const includeLogs = document.getElementById('include-logs')
const logsError = document.getElementById('logs-error')
const widgetContainer = document.getElementById('turnstile-widget')
const verificationError = document.getElementById('verification-error')
const retryVerification = document.getElementById('retry-verification')
const sendFeedback = document.getElementById('send-feedback')
const status = document.getElementById('feedback-status')
const encoder = new TextEncoder()

let config = null
let token = ''
let tokenTimer
let widgetId = null
let widgetGeneration = 0
let scriptPromise = null
let preparingVerification = false
let submitting = false
let submissionResultVisible = false

function showError(element, text, controls = []) {
  element.textContent = text
  element.hidden = !text
  for (const control of controls) {
    if (text) control.setAttribute('aria-invalid', 'true')
    else control.removeAttribute('aria-invalid')
  }
}

function validMessage() {
  const length = message.value.trim().length
  return length > 0 && length <= MAX_MESSAGE_LENGTH
}

function logByteCount() {
  return encoder.encode(logsPreview.value).byteLength
}

function updateControls() {
  const logsValid = !includeLogs.checked || logByteCount() <= MAX_LOG_BYTES
  sendFeedback.disabled = submitting || preparingVerification || !config || !token || !validMessage() || !logsValid
  retryVerification.disabled = submitting || preparingVerification
  draftFields.disabled = submitting
  form.setAttribute('aria-busy', String(submitting))
}

function validateMessage() {
  let error = ''
  if (!message.value.trim()) error = 'Enter a feedback message.'
  else if (message.value.trim().length > MAX_MESSAGE_LENGTH) error = 'Keep your feedback within 4,000 characters.'
  showError(messageError, error, [message])
  return !error
}

function updateLogSize() {
  const bytes = logByteCount()
  logsSize.textContent = bytes
    ? `${bytes.toLocaleString()} of ${MAX_LOG_BYTES.toLocaleString()} UTF-8 bytes.`
    : 'No logs.'
  showError(
    logsError,
    includeLogs.checked && bytes > MAX_LOG_BYTES
      ? 'The logs exceed 64 KiB. Remove more text or uncheck Include these logs.'
      : '',
    [logsPreview, includeLogs],
  )
  updateControls()
}

function clearToken() {
  token = ''
  clearTimeout(tokenTimer)
  updateControls()
}

function verificationFailed(text) {
  clearToken()
  showError(verificationError, text, [widgetContainer])
  if (!submissionResultVisible) status.textContent = text
}

logsPreview.addEventListener('input', updateLogSize)
includeLogs.addEventListener('change', updateLogSize)
message.addEventListener('input', () => {
  validateMessage()
  updateControls()
})
message.addEventListener('blur', () => {
  validateMessage()
})

function loadTurnstile() {
  if (window.turnstile?.render && window.turnstile?.reset) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT_URL
    script.async = true
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      script.onload = null
      script.onerror = null
      if (error) {
        script.remove()
        reject(error)
      } else resolve()
    }
    const timer = setTimeout(() => finish(new Error('Verification script unavailable')), 15000)
    script.onerror = () => finish(new Error('Verification script unavailable'))
    script.onload = () => {
      if (!window.turnstile?.render || !window.turnstile?.reset) {
        finish(new Error('Verification script unavailable'))
        return
      }
      finish()
    }
    document.head.append(script)
  }).catch((error) => {
    scriptPromise = null
    throw error
  })
  return scriptPromise
}

function renderWidget() {
  const generation = ++widgetGeneration
  widgetContainer.replaceChildren()
  widgetId = window.turnstile.render(widgetContainer, {
    sitekey: config.siteKey,
    action: config.action,
    'response-field': false,
    // Recovery is explicit so a failed challenge never causes an automatic POST retry.
    retry: 'never',
    'refresh-expired': 'manual',
    'refresh-timeout': 'manual',
    callback: (value) => {
      if (generation !== widgetGeneration || submitting) return
      clearToken()
      if (typeof value !== 'string' || !value || value.length > 2048) {
        verificationFailed('Verification failed. Choose Retry verification.')
        return
      }
      token = value
      tokenTimer = setTimeout(() => {
        if (generation === widgetGeneration) verificationFailed('Verification expired. Choose Retry verification.')
      }, TOKEN_LIFETIME_MS)
      showError(verificationError, '', [widgetContainer])
      if (!submissionResultVisible)
        status.textContent = 'Verification complete. Your feedback is ready to send when the message is filled in.'
      updateControls()
    },
    'expired-callback': () => {
      if (generation === widgetGeneration) verificationFailed('Verification expired. Choose Retry verification.')
    },
    'error-callback': () => {
      if (generation === widgetGeneration) verificationFailed('Verification failed. Choose Retry verification.')
    },
    'timeout-callback': () => {
      if (generation === widgetGeneration) verificationFailed('Verification timed out. Choose Retry verification.')
    },
  })
}

function resetWidget() {
  clearToken()
  if (widgetId === null) return
  try {
    window.turnstile.reset(widgetId)
  } catch {
    // Retire callbacks before removing an unusable widget, then permit a clean retry.
    widgetGeneration += 1
    try {
      window.turnstile.remove(widgetId)
    } catch {
      /* The widget may already be gone. */
    }
    widgetContainer.replaceChildren()
    widgetId = null
    verificationFailed('Verification could not restart. Choose Retry verification.')
  }
}

async function prepareVerification() {
  if (preparingVerification || submitting) return
  preparingVerification = true
  submissionResultVisible = false
  clearToken()
  showError(verificationError, '', [widgetContainer])
  status.textContent = 'Loading verification…'
  try {
    if (!config) {
      const response = await fetch('/api/config', {
        cache: 'no-store',
        credentials: 'same-origin',
        signal: AbortSignal.timeout(15000),
      })
      if (!response.ok) throw new Error('Configuration unavailable')
      const data = await response.json()
      if (
        !data ||
        typeof data.siteKey !== 'string' ||
        !data.siteKey.trim() ||
        typeof data.action !== 'string' ||
        !data.action.trim()
      ) {
        throw new Error('Configuration unavailable')
      }
      config = { siteKey: data.siteKey, action: data.action }
    }
    await loadTurnstile()
    if (widgetId === null) renderWidget()
    else resetWidget()
    if (!token && verificationError.hidden) status.textContent = 'Complete the verification before sending.'
  } catch {
    verificationFailed('Verification is unavailable. Your draft is kept. Choose Retry verification to try again.')
  } finally {
    preparingVerification = false
    updateControls()
  }
}

retryVerification.addEventListener('click', prepareVerification)

function explainFailure(responseStatus, code) {
  if (responseStatus === 403 && (code === 'verification_failed' || code === 'invalid_origin')) {
    const text = 'Feedback was not sent. Complete verification again before retrying.'
    showError(verificationError, text, [widgetContainer])
    return text
  }
  if (responseStatus === 429 && code === 'rate_limited') return 'Too many reports. Please try again later.'
  if (responseStatus === 400 && code === 'invalid_request') {
    return 'Feedback was not sent. Check that your message contains 1–4,000 characters and that any included logs are valid text.'
  }
  if (responseStatus === 413 && code === 'payload_too_large') {
    const text =
      'Feedback was not sent because it is too large. Keep the message within 4,000 characters and included logs within 64 KiB.'
    if (includeLogs.checked) showError(logsError, text, [logsPreview, includeLogs])
    return text
  }
  if (responseStatus === 415 && code === 'unsupported_media_type') {
    return 'Feedback was not sent because the request format was not accepted. Your draft is kept; please try again later.'
  }
  return 'Receipt could not be confirmed. Your draft has been kept. Please try again later.'
}

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  if (submitting || preparingVerification) return
  if (!validateMessage()) {
    message.focus()
    updateControls()
    return
  }
  if (includeLogs.checked && logByteCount() > MAX_LOG_BYTES) {
    showError(logsError, 'Included logs must be at most 64 KiB. Edit the logs or uncheck Include these logs.', [
      logsPreview,
      includeLogs,
    ])
    logsPreview.focus()
    updateControls()
    return
  }
  if (!config || !token) {
    verificationFailed('Complete verification before sending. Choose Retry verification if needed.')
    retryVerification.focus()
    return
  }
  const body = JSON.stringify({
    message: message.value.trim(),
    logs: includeLogs.checked ? logsPreview.value : '',
    turnstileToken: token,
  })
  submitting = true
  submissionResultVisible = false
  showError(verificationError, '', [widgetContainer])
  status.textContent = 'Sending feedback…'
  updateControls()
  let resultText
  try {
    const response = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(30000),
      body,
    })
    const result = await response.json()
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Unexpected response')
    if (response.status === 201 && result.ok === true) {
      message.value = ''
      showError(messageError, '', [message])
      logsPreview.value = ''
      includeLogs.checked = true
      updateLogSize()
      resultText = 'Feedback sent. Thank you.'
    } else {
      resultText = explainFailure(response.status, result.error)
    }
  } catch {
    resultText = 'Receipt could not be confirmed. Your draft has been kept. Please try again later.'
  } finally {
    // Tokens are single-use even when the response is lost. Never automatically resubmit.
    submissionResultVisible = true
    resetWidget()
    submitting = false
    updateControls()
    status.textContent = resultText
  }
})

// Keep controls safe before configuration or the third-party script is available.
// Logs the editor posted with this page are already in the preview.
updateLogSize()
prepareVerification()
