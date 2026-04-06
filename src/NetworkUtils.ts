import { Logger } from './global/Logger'

export class NetworkUtils {
  private static readonly logger = new Logger('NetworkUtils')
  public static async getSuccessfulResponseBody(url: string): Promise<ArrayBuffer> {
    const response = await window.fetch(url, {mode: 'cors'})
    if (!response.ok) {
      return Promise.reject('Request failed with ' + response.status + ' ' + response.statusText)
    }
    response.headers.forEach((value, key, _) => NetworkUtils.logger.debug('response header: ' + key + ' ' + value))
    return response.arrayBuffer()
  }
}
