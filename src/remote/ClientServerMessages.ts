export interface RoomInfoResponseMessage {
  readonly type: 'roomInfoResponse'
  readonly roomName: string
  readonly host: boolean
}

export interface ServerReportedError {
  readonly type: 'serverReportedError'
  readonly error: string
}

export interface TakeRoomMessage {
  readonly type: 'takeRoom'
  readonly username: string
  readonly roomName: string
}

export interface RoomNameSuggestionRequestMessage {
  readonly type: 'roomNameSuggestionRequest'
}

export interface RoomNameSuggestionResponseMessage {
  readonly type: 'roomNameSuggestionResponse'
  readonly roomName: string
}

export interface JoinRoomMessage {
  readonly type: 'joinRoom'
  readonly fromUser: string
  readonly roomName: string
}

export interface RtcOfferMessage {
  readonly type: 'rtcOffer'
  readonly fromUser: string
  readonly toUser: string
  readonly roomName: string
  readonly sessionDescriptionProtocol: RTCSessionDescriptionInit
}

export interface RtcAnswerMessage {
  readonly type: 'rtcAnswer'
  readonly fromUser: string
  readonly toUser: string
  readonly roomName: string
  readonly sessionDescriptionProtocol: RTCSessionDescriptionInit
}

export interface IceCandidateMessage {
  readonly type: 'iceCandidate'
  readonly fromUser: string
  readonly toUser: string
  readonly roomName: string
  readonly candidate: RTCIceCandidate
}

export interface NameChangeMessage {
  readonly type: 'nameChange'
  readonly oldName: string
  readonly newName: string
}

export interface ChatMessage {
  readonly type: 'chat'
  readonly fromUser: string
  readonly text: string
}

export type ServerMessage = RoomInfoResponseMessage | ServerReportedError | RoomNameSuggestionResponseMessage
export type ClientMessage =
  | TakeRoomMessage
  | JoinRoomMessage
  | RtcOfferMessage
  | RtcAnswerMessage
  | IceCandidateMessage
  | RoomNameSuggestionRequestMessage
export type Message = ServerMessage | ClientMessage
export type PeerMessage = RtcOfferMessage | RtcAnswerMessage | IceCandidateMessage | ChatMessage | JoinRoomMessage
