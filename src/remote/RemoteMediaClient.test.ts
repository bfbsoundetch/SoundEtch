import './FakesForRemoteTests'
import { expect, test } from 'vitest'
import { RemoteMediaClient3 } from './RemoteMediaClient3'

test('remote user connects', async () => {
    console.error(JSON.stringify(globalThis))
    const remoteMediaClient = new RemoteMediaClient3('test user')
    expect(remoteMediaClient.connections.size).toBe(0)
})