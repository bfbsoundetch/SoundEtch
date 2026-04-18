import { Logger } from '../global/Logger'
import { LocalMediaStreams } from '../mediastreams/LocalMediaStreams'
import { AudioInputs } from '../audioinputs/AudioInputs'
import { Peer, DataConnection, MediaConnection, PeerOptions, ConnectionType } from 'peerjs'

type PeerMessage =
  | {
    type: 'self'
    username: string
  }
  | {
    type: 'otherPeer'
    peer: string
  }
  | {
    type: 'peerDisconnected'
    peer: string
  }
  | {
    type: 'chat'
    message: string
  }

export interface Member {
  peerId: string
  username: string
  mediaStream: MediaStream
  error: string | null
}

export interface State {
  members: Array<Member>
  roomId: string | null
  screenShare: Member | 'self' | null
  error: string | null
}

export type StateListener = (state: State) => {}

export class RemoteMediaClient2 {
  private readonly peer: Peer
  private readonly state: State = { members: new Array<Member>(), roomId: null, screenShare: null, error: null }
  private readonly stateListeners = new Array<StateListener>()
  private readonly logger = new Logger('RemoteMediaClient')

  constructor(
    private readonly username: string,
    roomName: string | null = null,
  ) {
    LocalMediaStreams.registerAVDeviceListener((added, _) => {
      if (added) {
        this.connections.forEach((peerConnections) => {
          peerConnections.forEach(connection => {
            if (connection.type == ConnectionType.Data) {
              const mediaConnection = this.peer.call(connection.peer, LocalMediaStreams.localAVDeviceMediaStream, {
                metadata: { isScreenShare: false, soundetch: true },
              })
              this.setUpMediaConnection(mediaConnection)
            }
          })
        })
      } else if (LocalMediaStreams.localAVDeviceMediaStream.getTracks().length == 0) {
        this.connections.forEach((peerConnections) => {
          peerConnections.forEach(connection => {
            if (connection.type == ConnectionType.Media && !connection.metadata.isScreenShare) {
              connection.close()
            }
          })
        })
      }
    })
    LocalMediaStreams.registerScreenListener((added, _) => {
      if (added && this.state.screenShare != 'self') {
        if (this.state.screenShare) {
          LocalMediaStreams.endScreenShare()
        } else {
          this.state.screenShare = 'self'
          this.connections.forEach((peerConnections) => {
            peerConnections.forEach(connection => {
              if (connection.type == ConnectionType.Media) {
                (connection as MediaConnection).addStream(LocalMediaStreams.localScreenMediaStream)
              }
            })
          })
        }
        this.notifyStateListeners()
      } else if (!added && this.state.screenShare == 'self') {
        this.state.screenShare = null
        this.connections.forEach((peerConnections) => {
          peerConnections.forEach(connection => {
            if (connection.type == ConnectionType.Media && connection.metadata.isScreenShare) {
              connection.close()
            }
          })
        })
        this.notifyStateListeners()
      }
    })
    this.state.roomId = roomName
    this.peer = new Peer({ config: rtcConfig })

    this.peer.addListener('open', () => {
      console.debug('opened')
      if (!this.state.roomId) {
        this.state.roomId = this.peer.id
        this.notifyStateListeners()
      }
    })
    this.peer.addListener('error', (error) => {
      switch (error.type) {
        case 'disconnected':
        case 'browser-incompatible':
        case 'invalid-id':
        case 'invalid-key':
        case 'network':
        case 'peer-unavailable':
        case 'ssl-unavailable':
        case 'server-error':
        case 'socket-error':
        case 'socket-closed':
        case 'unavailable-id':
        case 'webrtc':
          this.state.error = error.message
          this.notifyStateListeners()
          break
      }
    })
    this.peer.addListener('connection', (dataConnection) => {
      console.debug('received a connection')
      if (!dataConnection.metadata.soundetch) {
        console.debug('connection was not from SoundEtch.')
        dataConnection.close()
        return
      }
      this.setUpDataConnection(dataConnection)
      this.notifyStateListeners()
    })
    this.peer.addListener('call', (mediaConnection) => {
      console.debug('received a call', JSON.stringify(mediaConnection.metadata))
      if (!mediaConnection.metadata.soundetch) {
        console.debug('call was not from SoundEtch.')
        mediaConnection.close()
        return
      }
      mediaConnection.answer()
      this.setUpMediaConnection(mediaConnection)
    })
    if (roomName) {
      this.joinRoom(roomName)
    }
  }

  get id(): string {
    return this.peer.id
  }

  get connections(): Map<string, Array<DataConnection | MediaConnection>> {
    return (this.peer as any)._connections
  }

  private getDataConnection(peerId: string): DataConnection {
    return (
      (this.connections.get(peerId)?.find((c) => c.type === ConnectionType.Data) as DataConnection | undefined) ??
      this.peer.connect(peerId, { metadata: { soundetch: true } })
    )
  }

  private getMediaConnection(peerId: string): MediaConnection | undefined {
    return this.connections
      .get(peerId)
      ?.find((c) => c.type === ConnectionType.Media) as
      | MediaConnection
      | undefined
  }

  joinRoom(roomId: string) {
    this.join(roomId)
  }

  disconnect() {
    this.peer.destroy()
  }

  addStateListener(listener: StateListener) {
    this.stateListeners.push(listener)
    listener(this.state)
  }

  async amInRoom() {
    return !!this.state.roomId && !this.state.error
  }

  private async join(peer: string) {
    this.peer.addListener('open', () => {
      this.setUpDataConnection(this.getDataConnection(peer))
    })
  }

  private notifyStateListeners() {
    for (let i = 0; i < this.stateListeners.length; ++i) {
      this.stateListeners[i](this.state)
    }
  }

  private getMember(peerId: string): Member | null {
    for (let i = 0; i < this.state.members.length; ++i) {
      if (this.state.members[i].peerId === peerId) {
        return this.state.members[i]
      }
    }
    return null
  }

  private deleteMember(peerId: string) {
    for (let i = 0; i < this.state.members.length; ++i) {
      if (this.state.members[i].peerId === peerId) {
        this.state.members.splice(i, 1)
        break
      }
    }
  }

  private handleDataMessage(self: DataConnection, data: unknown) {
    console.debug('received message', JSON.stringify(data))
    const peerMessage = data as PeerMessage
    switch (peerMessage.type) {
      case 'self': 
        this.state.members.push({
          peerId: self.peer,
          username: peerMessage.username,
          mediaStream: new MediaStream(),
          error: null,
        })
        this.notifyStateListeners()
        break
      case 'otherPeer':
        if (!this.connections.has(peerMessage.peer)) {
          this.join(peerMessage.peer)
        }
        break
      case 'peerDisconnected':
        if (this.connections.get(peerMessage.peer)?.find((c) => c?.open)) {
          // Two peers disconnected from each other, try to reconnect them.
          self.send({ type: 'otherPeer', peer: peerMessage.peer })
        }
        break
      case 'chat':
        break
    }
  }

  private setUpDataConnection(dataConnection: DataConnection) {
    dataConnection.addListener('open', () => {
      dataConnection.send({type: 'self', username: this.username})
    })
    dataConnection.addListener('close', () => {
      this.deleteMember(dataConnection.peer)
      if (this.state.screenShare != 'self' && this.state.screenShare?.peerId == dataConnection.peer) {
        this.state.screenShare = null
        AudioInputs.removeRemoteAudioSource(dataConnection.peer, true)
      }
      this.notifyStateListeners()
      AudioInputs.removeRemoteAudioSource(dataConnection.peer, false)
    })
    dataConnection.addListener('data', (data) => this.handleDataMessage(dataConnection, data))
    dataConnection.addListener('error', (e) => {
      this.deleteMember(dataConnection.peer)
      if (this.state.screenShare != 'self' && this.state.screenShare?.peerId == dataConnection.peer) {
        this.state.screenShare = null
        AudioInputs.removeRemoteAudioSource(dataConnection.peer, true)
      }
      this.notifyStateListeners()
      AudioInputs.removeRemoteAudioSource(dataConnection.peer, false)
      this.logger.error(e.message)
    })
  }

  private setUpMediaConnection(mediaConnection: MediaConnection) {
    mediaConnection.addListener('stream', (remoteStream) => {
      console.debug('on stream')
      const isScreenShare = !!remoteStream.getVideoTracks().find(track => !!track.getCapabilities().displaySurface)
      if (isScreenShare) {
        this.state.screenShare = this.getMember(mediaConnection.peer)
      } else {
        this.state.members.find(m => m.peerId == mediaConnection.peer)!.mediaStream = mediaConnection.remoteStream
      }
      if (remoteStream.getAudioTracks().length > 0) {
        AudioInputs.maybeAddRemoteAudioSource(
          mediaConnection.peer,
          isScreenShare,
          remoteStream.getAudioTracks()[0]!,
        )
      }

      this.notifyStateListeners()
      this.connections.keys().forEach((key) => {
        if (key != mediaConnection.peer) {
          this.getDataConnection(mediaConnection.peer).send({
            type: 'otherPeer',
            peer: key,
          })
        }
      })
    })
    mediaConnection.addListener('close', () => {
      this.logger.log('Closed connection to "' + mediaConnection.peer + '"')
      AudioInputs.removeRemoteAudioSource(mediaConnection.peer, mediaConnection.metadata.isScreenShare)
      if (this.state.screenShare != 'self' && this.state.screenShare?.peerId == mediaConnection.peer) {
        this.state.screenShare = null
      }
      this.notifyStateListeners()
    })
    mediaConnection.addListener('error', (error) => {
      this.logger.error('Lost connection to "' + mediaConnection.peer + '" due to: ' + error.message)
      AudioInputs.removeRemoteAudioSource(mediaConnection.peer, mediaConnection.metadata.isScreenShare)
      if (this.state.screenShare != 'self' && this.state.screenShare?.peerId == mediaConnection.peer) {
        this.state.screenShare = null
      }
      this.notifyStateListeners()
    })
    console.debug('done setting up MediaConnection to', mediaConnection.peer)
  }
}

const rtcConfig = {
  iceServers: [
    {
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
        'stun:stun2.l.google.com:19302',
        'stun:stun3.l.google.com:19302',
        'stun:stun4.l.google.com:19302',
        'stun:stun01.sipphone.com',
        'stun:stun.ekiga.net',
        'stun:stun.fwdnet.net',
        'stun:stun.ideasip.com',
        'stun:stun.iptel.org',
        'stun:stun.rixtelecom.se',
        'stun:stun.schlund.de',
        'stun:stunserver.org',
        'stun:stun.softjoys.com',
        'stun:stun.voiparound.com',
        'stun:stun.voipbuster.com',
        'stun:stun.voipstunt.com',
        'stun:stun.voxgratia.org',
        'stun:stun.xten.com',
      ],
    },
  ],
}
