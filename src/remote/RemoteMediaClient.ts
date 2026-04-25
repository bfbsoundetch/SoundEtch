import {
  Message,
  RtcOfferMessage,
  IceCandidateMessage,
  TakeRoomMessage,
  RtcAnswerMessage,
  ChatMessage,
  PeerMessage,
  JoinRoomMessage,
  ClientMessage,
} from './ClientServerMessages'
import { Logger } from '../global/Logger'
import { LocalMediaStreams } from '../mediastreams/LocalMediaStreams'
import { AudioInputs } from '../audioinputs/AudioInputs'

export interface Member {
  username: string
  mediaStream: MediaStream
  isScreenShare: boolean
  isSelf: boolean
}

export interface State {
  type: 'state'
  members: Array<Member>
  amInRoom: boolean
}

export class RemoteMediaClient {
  private hasServerConnection = false
  private readonly stateListeners = new Array<(_: State) => any>()
  private serverWebSocket: Promise<WebSocket> | null = null
  private roomName: string | null = null
  private host: boolean = false
  private readonly peers = new Map<string, Peer>()
  private readonly chatLog = new ChatLog()
  private roomNameSuggestion = Promise.withResolvers<string>()
  private readonly logger = new Logger('RemoteMediaClient')
  private readonly errorListeners = new Array<(_: string) => void>()

  constructor(
    readonly username: string,
    private readonly signalingServerHostname: string,
  ) {
    LocalMediaStreams.localAVDeviceMediaStream.addEventListener('addtrack', (trackEvent: MediaStreamTrackEvent) => {
      console.log('new track!!')
      this.notifyListeners()
      this.sendTrackToPeers(trackEvent.track)
    })
    LocalMediaStreams.localScreenMediaStream.addEventListener('addtrack', (trackEvent: MediaStreamTrackEvent) => {
      console.log('new track!!')
      this.notifyListeners()
      this.sendTrackToPeers(trackEvent.track)
    })
    LocalMediaStreams.localAVDeviceMediaStream.addEventListener('removetrack', (_: any) => this.notifyListeners())
    LocalMediaStreams.localScreenMediaStream.addEventListener('removetrack', (_: any) => this.notifyListeners())
    const listener = (added: boolean, track: MediaStreamTrack) => {
      if (added) {
        this.logger.log('Added a track ' + track.label)
        this.sendTrackToPeers(track)
      } else {
        this.logger.log('Removed a track ' + track.label)
        this.removeTrackFromPeers(track)
      }
      this.notifyListeners()
    }
    LocalMediaStreams.registerAVDeviceListener(listener)
    LocalMediaStreams.registerScreenListener(listener)
  }

  async getRoomNameSuggestion(): Promise<string> {
    await this.sendToServer({
      type: 'roomNameSuggestionRequest',
    })
    return this.roomNameSuggestion.promise
  }

  private closePeerConnection(username: string) {
    const peerConnection = this.peers.get(username)
    if (peerConnection === undefined) {
      return
    }
    this.logger.log('--> Closing the peer connection')
    peerConnection.close()
    this.removePeer(peerConnection)
    this.notifyListeners()
  }

  getAndMaybeAddPeerConnection(username: string): Peer {
    const existing = this.peers.get(username)
    if (existing) {
      return existing
    }
    this.logger.log('Adding a peer for ' + username)
    const newPeerConnection = new RTCPeerConnection({
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
    })
    newPeerConnection.onicecandidate = async (event: RTCPeerConnectionIceEvent) => {
      this.logger.log(`Ice ice baby ;) ${event.candidate}`)
      if (event.candidate == null) {
        return
      }
      const iceCandidateMessage: IceCandidateMessage = {
        type: 'iceCandidate',
        fromUser: this.username,
        toUser: username,
        roomName: this.roomName!,
        candidate: event.candidate,
      }
      this.sendToHost(iceCandidateMessage)
    }

    newPeerConnection.oniceconnectionstatechange = () => {
      this.logger.log('New ice connecting state ' + newPeerConnection.iceConnectionState)
      switch (newPeerConnection.iceConnectionState) {
        case 'closed':
        case 'failed':
        case 'disconnected':
          this.closePeerConnection(username)
          break
      }
    }
    newPeerConnection.onicegatheringstatechange = () => {
      this.logger.log('New ice gathering state' + newPeerConnection.iceGatheringState)
    }
    newPeerConnection.onsignalingstatechange = () => {
      this.logger.log('New signaling state' + newPeerConnection.signalingState)
      switch (newPeerConnection.signalingState) {
        case 'closed':
          this.closePeerConnection(username)
          break
      }
    }
    newPeerConnection.onicecandidateerror = (event: RTCPeerConnectionIceErrorEvent) => {
      this.logger.errorMessage(event.errorCode + ' ' + event.errorText)
    }
    newPeerConnection.onnegotiationneeded = () => this.negotiateRtc(newPeerConnection, username)
    const peer = new Peer(this, newPeerConnection, username, this.chatLog, (_: Peer) => {
      this.notifyListeners()
    })
    this.peers.set(username, peer)
    return peer
  }

  getNextChatLogMessage(): AsyncGenerator<ChatMessage> {
    return this.chatLog.getNextMessage()
  }

  async takeRoom(roomName: string) {
    const takeRoomMessage: TakeRoomMessage = {
      type: 'takeRoom',
      username: this.username,
      roomName: roomName,
    }
    this.sendToServer(takeRoomMessage)
  }

  async joinRoom(roomName: string) {
    this.logger.log('join rooooooooooooom')
    const joinRoomMessage: JoinRoomMessage = {
      type: 'joinRoom',
      fromUser: this.username,
      roomName: roomName,
    }
    this.sendToServer(joinRoomMessage)
  }

  async negotiateRtc(newPeerConnection: RTCPeerConnection, toUser: string) {
    this.logger.log('I need to neg!')
    const offer = await newPeerConnection.createOffer()
    // If the connection hasn't yet achieved the "stable" state,
    // return to the caller. Another negotiationneeded event
    // will be fired when the state stabilizes.
    if (newPeerConnection.signalingState !== 'stable') {
      return
    }
    await newPeerConnection.setLocalDescription(offer)
    await this.getSignalingServerConnection()
    this.sendToHost({
      type: 'rtcOffer',
      fromUser: this.username,
      toUser: toUser,
      roomName: this.roomName!,
      sessionDescriptionProtocol: newPeerConnection.localDescription!.toJSON(),
    })
  }

  addChatMessageListener(listener: (_: ChatMessage) => any) {
    this.chatLog.addMessageListener(listener)
  }

  amInRoom(): boolean {
    if (!this.roomName) {
      return false
    }
    // If you're the host, have a room name, and a server connection
    // you're in the room.
    if (this.host && this.hasServerConnection) {
      return true
    }
    // If you're a guest, you must be accepted into the room.
    for (const [_, peer] of this.peers) {
      if (peer.canSendMessages()) {
        return true
      }
    }
    return false
  }

  private getState(): State {
    const state: State = {
      type: 'state',
      members: [],
      amInRoom: this.amInRoom(),
    }
    state.members.push({
      username: this.username,
      mediaStream: LocalMediaStreams.localAVDeviceMediaStream,
      isScreenShare: false,
      isSelf: true,
    })
    if (LocalMediaStreams.localScreenMediaStream.getTracks().length > 0) {
      console.error(LocalMediaStreams.localScreenMediaStream.getTracks().map((t) => t.label))
      state.members.push({
        username: this.username,
        mediaStream: LocalMediaStreams.localScreenMediaStream,
        isScreenShare: true,
        isSelf: true,
      })
    }
    this.peers.forEach((peer) => {
      state.members.push({
        username: peer.username,
        mediaStream: peer.mediaStream,
        isScreenShare: false,
        isSelf: false,
      })
      if (peer.screenShareMediaStream) {
        state.members.push({
          username: peer.username,
          mediaStream: peer.screenShareMediaStream,
          isScreenShare: true,
          isSelf: false,
        })
      }
    })
    this.logger.log('mein shtaat ist ' + JSON.stringify(state))
    return state
  }

  private notifyListeners() {
    this.logger.log('!!!!!!!!notifyListeners!!!!!!!!!!')
    this.stateListeners.forEach((listener) => listener(this.getState()))
  }

  private getSignalingServerConnection(): Promise<WebSocket> {
    if (this.serverWebSocket != null) {
      return this.serverWebSocket
    }
    const serverWebSocket = new WebSocket(`https://${this.signalingServerHostname}:6503`, 'json')

    serverWebSocket.onmessage = (event: MessageEvent) => {
      const message: Message = JSON.parse(event.data)
      this.logger.log('event data: ' + JSON.stringify(message))
      switch (message.type) {
        case 'rtcOffer':
          this.answerRemoteOffer(message)
          break
        case 'rtcAnswer':
          this.getAndMaybeAddPeerConnection(message.fromUser).rtcPeerConnection.setRemoteDescription(
            new RTCSessionDescription(message.sessionDescriptionProtocol),
          )
          break
        case 'roomInfoResponse':
          this.roomName = message.roomName
          this.host = message.host
          this.logger.log('url: ' + this.getRoomInviteUrl())
          this.notifyListeners()
          break
        case 'joinRoom':
          this.peers.forEach((peer) => peer.sendMessage(message))
          this.getAndMaybeAddPeerConnection(message.fromUser)
          break
        case 'iceCandidate':
          this.getAndMaybeAddPeerConnection(message.fromUser)!.rtcPeerConnection.addIceCandidate(message.candidate)
          break
        case 'serverReportedError':
          this.logger.errorMessage(message.error)
          if (this.serverWebSocket) {
            this.serverWebSocket.then((s) => {
              s.close()
              this.serverWebSocket = null
            })
          }
          this.errorListeners.forEach((l) => l(message.error))
          break
        case 'roomNameSuggestionResponse':
          this.roomNameSuggestion.resolve(message.roomName)
          break
      }
    }

    return (this.serverWebSocket = new Promise((resolve, reject) => {
      serverWebSocket.onopen = (event: Event) => {
        this.hasServerConnection = true
        this.notifyListeners()
        resolve(serverWebSocket)
      }

      serverWebSocket.onerror = (event: Event) => {
        this.hasServerConnection = false
        this.notifyListeners()
        reject(event)
      }

      serverWebSocket.onclose = (closeEvent: CloseEvent) => {
        this.logger.log(
          `Closing the web server connection. ${closeEvent.code} Reason: ${closeEvent.reason}. Type ${closeEvent.type}`,
        )
        this.hasServerConnection = false
        this.serverWebSocket = null
        this.notifyListeners()
        reject(closeEvent)
      }
    }))
  }

  async answerRemoteOffer(offer: RtcOfferMessage) {
    const peerConnection = this.getAndMaybeAddPeerConnection(offer.fromUser).rtcPeerConnection
    const sessionDescription = new RTCSessionDescription(offer.sessionDescriptionProtocol)
    if (!this.host && peerConnection.signalingState != 'stable') {
      // Set the local and remove descriptions for rollback; don't proceed
      // until both return.
      this.logger.errorMessage('Peer connection was not stable ' + peerConnection.signalingState)
      await Promise.all([
        peerConnection.setLocalDescription({ type: 'rollback' }),
        peerConnection.setRemoteDescription(sessionDescription),
      ])
      return
    } else {
      await peerConnection.setRemoteDescription(sessionDescription)
    }
    await peerConnection.setLocalDescription(await peerConnection.createAnswer())
    const answer: RtcAnswerMessage = {
      type: 'rtcAnswer',
      toUser: offer.fromUser,
      fromUser: this.username,
      roomName: this.roomName!,
      sessionDescriptionProtocol: peerConnection.localDescription!.toJSON(),
    }
    this.sendToHost(answer)
  }

  addErrorListener(listener: (_: string) => any) {
    this.errorListeners.push(listener)
  }

  private async sendToHost(message: ClientMessage) {
    switch (message.type) {
      case 'rtcOffer':
      case 'rtcAnswer':
      case 'iceCandidate':
        const targetPeerConnection = this.peers.get(message.toUser)
        if (targetPeerConnection?.canSendMessages()) {
          this.logger.log('sending via peer connection' + JSON.stringify(message))
          targetPeerConnection.sendMessage(message)
          return
        }
      default:
        break
    }
    this.logger.log('I am sending to host' + JSON.stringify(message))
    this.sendToServer(message)
  }

  private async sendToServer(message: ClientMessage) {
    try {
      const signalingServerConnection = await this.getSignalingServerConnection()
      signalingServerConnection.send(JSON.stringify(message))
    } catch (e: any) {
      this.errorListeners.forEach((l) => l('Could not connect to server.'))
      throw e
    }
  }

  private sendTrackToPeers(track: MediaStreamTrack) {
    this.peers.forEach((peer) => {
      this.logger.log('my kinda track ' + JSON.stringify(track.getCapabilities()))
      const mediaStream = !track.getCapabilities().displaySurface
        ? LocalMediaStreams.localAVDeviceMediaStream
        : LocalMediaStreams.localScreenMediaStream
      const rtcRtpSender = peer.rtcPeerConnection.addTrack(track, mediaStream)
      track.addEventListener('ended', (_) => peer.rtcPeerConnection.removeTrack(rtcRtpSender))
    })
  }

  private removeTrackFromPeers(track: MediaStreamTrack) {
    this.peers.forEach((peer) => {
      peer.rtcPeerConnection.getSenders().forEach((s) => {
        if (s.track == track) {
          console.error('removing')
          peer.rtcPeerConnection.removeTrack(s)
        }
      })
    })
  }

  addStateListener(listener: (_: State) => any) {
    listener(this.getState())
    this.stateListeners.push(listener)
  }

  getRoomInviteUrl(): string | null {
    if (!this.roomName) {
      return null
    }
    return `?meeting=${this.roomName}`
  }

  sendChatToPeers(message: string) {
    const chatMessage: ChatMessage = {
      type: 'chat',
      fromUser: this.username,
      text: message,
    }
    this.chatLog.addMessage(chatMessage)
    this.sendToAllPeers(chatMessage)
  }

  sendToAllPeers(peerMessage: PeerMessage) {
    this.peers.forEach((peer) => {
      this.logger.errorMessage(`sending to ${peer.username}: ${JSON.stringify(peerMessage)}`)
      if (peer.username != peerMessage.fromUser) {
        peer.sendMessage(peerMessage)
      }
    })
  }

  maybeSendToPeer(peerMessage: PeerMessage, toUser: string) {
    this.logger.log(`Currently, my peers are ${JSON.stringify(this.peers)}`)
    this.logger.log(`Trying to send to ${toUser}`)
    this.peers.get(toUser)?.sendMessage(peerMessage)
  }

  removePeer(peer: Peer) {
    this.peers.delete(peer.username)
  }

  async disconnect() {
    if (this.serverWebSocket) {
      ;(await this.serverWebSocket).close()
    }
    this.peers.forEach((p) => p.close())
  }
}

class Peer {
  readonly mediaStream = new MediaStream()
  screenShareMediaStream: MediaStream | null = null
  private sendChannelPromise: Promise<RTCDataChannel>
  private sendChannelReady = false
  private readonly logger: Logger

  constructor(
    private readonly remoteMediaClient: RemoteMediaClient,
    readonly rtcPeerConnection: RTCPeerConnection,
    readonly username: string,
    private readonly chatLog: ChatLog,
    private readonly updateListener: (_: Peer) => any,
  ) {
    const channel = rtcPeerConnection.createDataChannel('sendChannel')
    this.sendChannelPromise = new Promise((resolve, reject) => {
      channel.onopen = () => {
        this.logger.log('Data channel opens')
        resolve(channel)
        this.sendChannelReady = true
        this.updateListener(this)
      }

      channel.onclose = () => {
        this.logger.log('data close')
        this.sendChannelReady = false
        this.remoteMediaClient.removePeer(this)
        this.updateListener(this)
      }
      channel.onclosing = () => {
        this.logger.log('data closing')
        this.sendChannelReady = false
        this.remoteMediaClient.removePeer(this)
        this.updateListener(this)
      }
      channel.onerror = (event) => {
        this.logger.log('Data Error, bud: ' + event)
        this.sendChannelReady = false
        this.remoteMediaClient.removePeer(this)
        this.updateListener(this)
        reject(event)
      }
    })
    this.logger = new Logger(`Peer_${this.username}`)
    rtcPeerConnection.ondatachannel = (channelEvent) => {
      channelEvent.channel.onmessage = (event) => {
        this.logger.errorMessage(`receive ${event.data}`)
        const peerMessage: PeerMessage = JSON.parse(event.data)
        this.handlePeerMessage(peerMessage)
      }
    }
    rtcPeerConnection.ontrack = (trackEvent) => this.handleTrackEvent(trackEvent)
    LocalMediaStreams.localAVDeviceMediaStream
      .getTracks()
      .concat(LocalMediaStreams.localScreenMediaStream.getTracks())
      .forEach((track) => {
        const rtcRtpSender = rtcPeerConnection.addTrack(track)
        track.addEventListener('ended', (_) => rtcPeerConnection.removeTrack(rtcRtpSender))
      })
  }

  async handlePeerMessage(peerMessage: PeerMessage) {
    this.logger.log(`handlePeerMessage! :) ${peerMessage.type}`)
    switch (peerMessage.type) {
      case 'chat':
        this.chatLog.addMessage(peerMessage)
        break
      case 'joinRoom':
        this.remoteMediaClient.getAndMaybeAddPeerConnection(peerMessage.fromUser)
        break
      default:
        if (peerMessage.toUser == this.remoteMediaClient.username) {
          switch (peerMessage.type) {
            case 'rtcOffer':
              this.logger.log(`handle my rtc offer, please`)
              this.remoteMediaClient.answerRemoteOffer(peerMessage)
              break
            case 'rtcAnswer':
              this.rtcPeerConnection.setRemoteDescription(
                new RTCSessionDescription(peerMessage.sessionDescriptionProtocol),
              )
              break
            case 'iceCandidate':
              this.rtcPeerConnection.addIceCandidate(peerMessage.candidate)
              break
          }
        } else {
          this.remoteMediaClient.maybeSendToPeer(peerMessage, peerMessage.toUser)
        }
        break
    }
  }

  async sendMessage(message: PeerMessage) {
    this.logger.log(`Sending peer ${this.username} a ${message.type}`)
    const dataChannel = await this.sendChannelPromise
    dataChannel.send(JSON.stringify(message))
  }

  private handleTrackEvent(trackEvent: RTCTrackEvent) {
    this.logger.log('got track')
    const track = trackEvent.track

    const isScreenShare = !!track.getCapabilities().displaySurface
    if (isScreenShare) {
      this.screenShareMediaStream = new MediaStream([track])
      track.addEventListener('ended', (event: Event) => {
        this.screenShareMediaStream!.removeTrack(track)
        if (this.screenShareMediaStream!.getTracks().length == 0) {
          this.screenShareMediaStream = null
        }
      })
      trackEvent.streams.forEach(
        (stream) =>
          (stream.onremovetrack = (trackEvent) => {
            this.screenShareMediaStream!.removeTrack(trackEvent.track)
            if (this.screenShareMediaStream!.getTracks().length == 0) {
              this.screenShareMediaStream = null
            }
          }),
      )
    } else {
      this.mediaStream.addTrack(track)
      track.addEventListener('ended', (event: Event) => {
        this.mediaStream.removeTrack(track)
      })
      trackEvent.streams.forEach(
        (stream) =>
          (stream.onremovetrack = (trackEvent) => {
            console.error('that is what i thought')
            this.mediaStream.removeTrack(trackEvent.track)
            this.updateListener(this)
          }),
      )
    }
    if (track.kind == 'audio') {
      AudioInputs.maybeAddRemoteAudioSource(this.username, isScreenShare, track)
      track.addEventListener('ended', (event: Event) => {
        AudioInputs.removeRemoteAudioSource(this.username, isScreenShare)
      })
    }
    this.updateListener(this)
  }

  canSendMessages(): boolean {
    return this.sendChannelReady
  }

  close() {
    // Disconnect all our event listeners; we don't want stray events
    // to interfere with the hangup while it's ongoing.
    this.rtcPeerConnection.ontrack = null
    this.rtcPeerConnection.onicecandidate = null
    this.rtcPeerConnection.oniceconnectionstatechange = null
    this.rtcPeerConnection.onsignalingstatechange = null
    this.rtcPeerConnection.onicegatheringstatechange = null
    this.rtcPeerConnection.onnegotiationneeded = null

    // Stop all transceivers on the connection
    this.rtcPeerConnection.getTransceivers().forEach((transceiver) => {
      transceiver.stop()
    })

    // Close the peer connection
    this.rtcPeerConnection.close()
  }
}

class ChatLog {
  private readonly messages = new Array<ChatMessage>()
  private resolver: Function
  private nextMessagePromise: Promise<ChatMessage>
  private messageListeners = new Array<(_: ChatMessage) => any>()
  private readonly logger = new Logger('ChatLog')

  constructor() {
    let { promise, resolve, reject } = Promise.withResolvers<ChatMessage>()
    this.resolver = resolve
    this.nextMessagePromise = promise
  }

  addMessage(message: ChatMessage) {
    this.logger.log(`New message from ${message.fromUser}: ${message.text}`)
    this.messages.push(message)
    this.messageListeners.forEach((listener) => listener(message))
  }

  addMessageListener(listener: (_: ChatMessage) => any) {
    this.messageListeners.push(listener)
  }

  async *getNextMessage(): AsyncGenerator<ChatMessage> {
    while (true) {
      const result = await this.nextMessagePromise
      let { promise, resolve, reject } = Promise.withResolvers<ChatMessage>()
      this.nextMessagePromise = promise
      this.resolver = resolve
      yield result
    }
  }
}
