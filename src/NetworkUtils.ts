import { Logger } from './global/Logger'

export class NetworkUtils {
  private static readonly logger = new Logger('NetworkUtils')
  public static getSuccessfulResponseBody(url: string): Promise<ArrayBuffer> {
    return window.fetch(url, { mode: 'cors' }).then((response) => {
      if (!response.ok) {
        return Promise.reject('Request failed with ' + response.status + ' ' + response.statusText)
      }
      response.headers.forEach((value, key, _) => NetworkUtils.logger.debug('response header: ' + key + ' ' + value))
      return response.arrayBuffer()
    })
  }
}
