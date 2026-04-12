import { Logger } from './global/Logger'

export class NetworkUtils {
  private static readonly logger = new Logger('NetworkUtils')

  public static async getSuccessfulResponseBody(url: string): Promise<ArrayBuffer> {
    const response = await NetworkUtils.getSuccessfulResponse(url)
    return response.arrayBuffer()
  }

  public static async getSuccessfulResponse(url: string, signal?: AbortSignal): Promise<Response> {
    const response = await window.fetch(url, { mode: 'cors', signal })
    if (!response.ok) {
      return Promise.reject('Request failed with ' + response.status + ' ' + response.statusText)
    }
    response.headers.forEach((value, key, _) => NetworkUtils.logger.debug('response header: ' + key + ' ' + value))
    return response
  }

  public static async downloadFile(
    url: string,
    filename: string,
    onProgress?: (progress: number) => void,
    signal?: AbortSignal,
  ): Promise<File> {
    const response = await NetworkUtils.getSuccessfulResponse(url, signal)
    const body = response.body
    if (!body) {
      const blob = await response.blob()
      onProgress?.(1)
      return new File([blob], filename)
    }

    const contentLengthHeader = response.headers.get('content-length')
    const totalBytes = contentLengthHeader ? Number(contentLengthHeader) : NaN
    const reader = body.getReader()
    const chunks: ArrayBuffer[] = []
    let receivedBytes = 0

    try {
      while (true) {
        NetworkUtils.throwIfAborted(signal)
        const { value, done } = await reader.read()
        if (done) {
          break
        }
        if (!value) {
          continue
        }
        const chunk = value.slice()
        chunks.push(chunk.buffer as ArrayBuffer)
        receivedBytes += value.byteLength
        if (Number.isFinite(totalBytes) && totalBytes > 0) {
          onProgress?.(receivedBytes / totalBytes)
        }
      }
    } finally {
      reader.releaseLock()
    }

    onProgress?.(1)
    return new File(chunks, filename)
  }

  private static throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError')
    }
  }
}
