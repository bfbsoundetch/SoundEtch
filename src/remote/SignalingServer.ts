import {
  server as WebSocketServer,
  connection as WebSocketConnection,
  Message,
  request as WebSocketRequest,
} from 'websocket'
import * as https from 'https'
import * as fs from 'fs'
import { ClientMessage, ServerReportedError, RoomInfoResponseMessage } from './ClientServerMessages'
import { Logger } from '../global/Logger'

export class Host {
  private static TIMEOUT_MS = 300_000

  private timeout: NodeJS.Timeout | null = null
  readonly guestConnections = new Map<string, WebSocketConnection>()

  constructor(
    readonly id: string,
    readonly username: string,
    readonly connection: WebSocketConnection,
  ) {
    this.refreshTimeout(connection)
    connection.addListener('message', (_: Message) => this.refreshTimeout(connection))
  }

  maybeAddGuestConnection(username: string, guestConnection: WebSocketConnection): boolean {
    if (this.guestConnections.has(username) || this.username == username) {
      return false
    }
    this.guestConnections.set(username, guestConnection)
    return true
  }

  private refreshTimeout(connection: WebSocketConnection) {
    if (this.timeout) {
      this.timeout.refresh()
      return
    }
    this.timeout = setTimeout(() => {
      const error: ServerReportedError = {
        type: 'serverReportedError',
        error: `Timed out before a guest connected.`,
      }
      connection.send(JSON.stringify(error))
      this.close()
    }, Host.TIMEOUT_MS)
  }

  close() {
    this.connection.close()
    this.guestConnections.forEach((connection, name) => connection.close())
  }
}

export class SignalingServer {
  private readonly hosts = new Map<string, Host>()
  private readonly logger = new Logger('SignalingServer')

  static HTTPS_SERVER_OPTIONS: https.ServerOptions = {
    key: fs.readFileSync('./cert/key.pem'),
    cert: fs.readFileSync('./cert/cert.pem'),
  }

  private readonly webSocketServer = new WebSocketServer({
    httpServer: https
      .createServer(SignalingServer.HTTPS_SERVER_OPTIONS, (request, response) => {
        response.writeHead(400)
        response.write('This server is only to perform signaling for a SoundEtch remote connection.')
        response.end()
      })
      .listen(6503),
  }).on('request', (request: WebSocketRequest) => {
    const webSocketConnection = request.accept('json')
    webSocketConnection.on('message', (message: Message) => this.onConnectionMessage(webSocketConnection, message))
  })

  private getNewId(): string {
    var candidate: string
    do {
      candidate = Math.random().toString(36).slice(2, 9)
    } while (this.hosts.has(candidate))
    return candidate
  }

  private onConnectionMessage(thisConnection: WebSocketConnection, message: Message) {
    const clientMessage = SignalingServer.messageToClientMessage(message)
    this.logger.log('got a message :) ' + JSON.stringify(clientMessage))
    switch (clientMessage?.type) {
      case 'roomNameSuggestionRequest':
        thisConnection.send(
          JSON.stringify({
            type: 'roomInfoSuggestionResponse',
            roomName: this.getNewId(),
          }),
        )
        break
      case 'takeRoom':
        if (this.hosts.has(clientMessage.roomName)) {
          SignalingServer.sendError(thisConnection, `Room ${clientMessage.roomName} is already taken.`)
          return
        }
        const roomInfo: RoomInfoResponseMessage = {
          type: 'roomInfoResponse',
          roomName: clientMessage.roomName,
          host: true,
        }
        this.hosts.set(clientMessage.roomName, new Host(clientMessage.roomName, clientMessage.username, thisConnection))
        thisConnection.on('close', () => {
          this.hosts.get(clientMessage.roomName)!.close()
          this.hosts.delete(clientMessage.roomName)
        })
        thisConnection.send(JSON.stringify(roomInfo))
        break
      case 'joinRoom':
        {
          const host = this.hosts.get(clientMessage.roomName)
          if (!host) {
            SignalingServer.sendError(thisConnection, `Host ${clientMessage.roomName} not found.`)
            return
          }
          if (!host.maybeAddGuestConnection(clientMessage.fromUser, thisConnection)) {
            SignalingServer.sendError(thisConnection, `Host ${clientMessage.roomName} is not available.`)
            return
          }
          thisConnection.send(
            JSON.stringify({
              type: 'roomInfoResponse',
              roomName: clientMessage.roomName,
              host: false,
            }),
          )
          host.connection.send(JSON.stringify(clientMessage))
        }
        break
      case 'rtcOffer':
      case 'rtcAnswer':
      case 'iceCandidate':
        const host = this.hosts.get(clientMessage.roomName)
        if (!host) {
          SignalingServer.sendError(thisConnection, `Host ${clientMessage.roomName} not found.`)
          return
        }
        let recipientConnection =
          host.username == clientMessage.toUser ? host.connection : host.guestConnections.get(clientMessage.toUser)
        if (!recipientConnection) {
          SignalingServer.sendError(thisConnection, `User ${clientMessage.toUser} on ${clientMessage.type} not found`)
          return
        }
        recipientConnection!.send(JSON.stringify(clientMessage))
        break
    }
  }

  private static messageToClientMessage(message: Message): ClientMessage | null {
    if (message.type !== 'utf8') {
      return null
    }
    return JSON.parse(message.utf8Data)
  }

  private static sendError(thisConnection: WebSocketConnection, message: string) {
    const error: ServerReportedError = {
      type: 'serverReportedError',
      error: message,
    }
    thisConnection.send(JSON.stringify(error))
  }

  private static maybeParseUrl(candidate: any): URL | null {
    if (URL.canParse(candidate)) {
      return null
    }
    return URL.parse(candidate)
  }
}

const unused = new SignalingServer()
new Logger('Node Server').log('And so it begins...')
