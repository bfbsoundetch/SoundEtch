import { createHash } from 'node:crypto'
import { expect, test } from 'vitest'
import { DROPBOX_BLOCK_SIZE, DropboxContentHasher, dropboxContentHash } from './DropboxContentHasher'

const MiB = 1024 * 1024

/** The algorithm as https://www.dropbox.com/developers/reference/content-hash describes it. */
function referenceContentHash(data: Uint8Array): string {
  const blockDigests = new Array<Buffer>()
  for (let offset = 0; offset < data.length; offset += DROPBOX_BLOCK_SIZE) {
    blockDigests.push(
      createHash('sha256')
        .update(data.subarray(offset, offset + DROPBOX_BLOCK_SIZE))
        .digest(),
    )
  }
  return createHash('sha256').update(Buffer.concat(blockDigests)).digest('hex')
}

function pseudoRandomBytes(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length)
  let state = 0x9e3779b9
  for (let index = 0; index < length; ++index) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    bytes[index] = state & 0xff
  }
  return bytes
}

test('the content hash matches the Dropbox reference however the input is split', async () => {
  const data = pseudoRandomBytes(9 * MiB + 3)
  const expected = referenceContentHash(data)
  for (const pieceSize of [MiB - 1, 4 * MiB, data.length]) {
    const hasher = new DropboxContentHasher()
    for (let offset = 0; offset < data.length; offset += pieceSize) {
      await hasher.update(data.subarray(offset, offset + pieceSize))
    }
    expect(await hasher.digest(), `pieces of ${pieceSize} bytes`).toBe(expected)
  }
})

test('empty input hashes to the SHA-256 of no block digests', async () => {
  expect(await dropboxContentHash(new Uint8Array())).toBe(
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  )
})
