import { Server, WebSocket } from 'mock-socket'
import { ServerMessageType, util } from 'peerjs'


const globals = {
    location: 'http://',
    WebSocket,
    MediaStream: class MediaStream {
        private readonly tracks = new Array<MediaStreamTrack>()

        getTracks() {
            return this.tracks
        }
    },
    MediaStreamTrack: class MediaStreamTrack {},
    createMockServer: (messageSequence: Array<string> = []) => {
        const mesagePromiseSequence = messageSequence.map(name => {return {name, promiseWithResolvers: Promise.withResolvers()}})
        const serverMessagePromise = Promise.all(mesagePromiseSequence.map(p => p.promiseWithResolvers.promise))
        const fakeURL = 'ws://localhost:8080/peerjs?key=peerjs&id=1&token=testToken'
        const mockServer = new Server(fakeURL)
        mockServer.on('connection', (socket) => {
            socket.on('message', (data) => {
                console.debug('server got message', data)
                if (typeof data === 'string') {
                    const message = JSON.parse(data)
                    if (message.type == mesagePromiseSequence[0].name) {
                        mesagePromiseSequence.pop()!.promiseWithResolvers.resolve(null)
                    } else {
                        mesagePromiseSequence[0].promiseWithResolvers.reject(
                            `Server got message ${message.type} but expected ${mesagePromiseSequence[0].name}`
                        )
                    }
                }
                socket.send("test message from mock server")
            })

            socket.send(JSON.stringify({ type: ServerMessageType.Open }))
        })

        ;(global as any).serverMessagePromise = serverMessagePromise
        ;(globalThis as any).serverMessagePromise = serverMessagePromise
        return mockServer
    },
}

//enable support for WebRTC
util.supports.data = true;
util.randomToken = () => "testToken";
Object.assign(globalThis, globals)
Object.assign(global, globals)
