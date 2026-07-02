import './FakesForRemoteTests'
import { expect, test } from 'vitest'
import { RemoteMediaClient3 } from './RemoteMediaClient3'
import { Server } from 'mock-socket'
import { ServerMessageType } from 'peerjs'

test('remote user connects', async () => {
    const server = (global as any).createMockServer(['a', '']) as Server
    const remoteMediaClient = new RemoteMediaClient3('test user', null, true)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(remoteMediaClient.connections.size).toBe(0)
    server.emit('message', JSON.stringify({type: ServerMessageType.Offer, dst: 'username'}))
    await globalThis.serverMessagePromise
})