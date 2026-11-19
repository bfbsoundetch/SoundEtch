/** Content is hashed in blocks of this size. */
export const CONTENT_HASH_BLOCK_SIZE = 4 * 1024 * 1024

const SHA256_LENGTH = 32

/**
 * Computes the content hash of backed-up files: SHA-256 of each 4 MiB block, then SHA-256 of the concatenated block
 * digests. This is Dropbox's content hash (https://www.dropbox.com/developers/reference/content-hash), so Dropbox
 * verifies uploads against it; every provider uses it, so a resumed upload continues from persisted block digests.
 */
export class ContentHasher {
  private readonly hashes: Uint8Array[]
  private block: Uint8Array<ArrayBuffer> | null = null
  private blockLength = 0

  /** `blockHashes` continues a hash whose earlier blocks were digested elsewhere. */
  constructor(blockHashes: readonly Uint8Array[] = []) {
    this.hashes = [...blockHashes]
  }

  async update(data: Uint8Array): Promise<void> {
    let offset = 0
    while (offset < data.length) {
      // Whole blocks of an unshared buffer are digested in place.
      if (
        this.blockLength == 0 &&
        data.length - offset >= CONTENT_HASH_BLOCK_SIZE &&
        data.buffer instanceof ArrayBuffer
      ) {
        const block = new Uint8Array(data.buffer, data.byteOffset + offset, CONTENT_HASH_BLOCK_SIZE)
        this.hashes.push(new Uint8Array(await crypto.subtle.digest('SHA-256', block)))
        offset += CONTENT_HASH_BLOCK_SIZE
        continue
      }
      this.block ??= new Uint8Array(CONTENT_HASH_BLOCK_SIZE)
      const count = Math.min(CONTENT_HASH_BLOCK_SIZE - this.blockLength, data.length - offset)
      this.block.set(data.subarray(offset, offset + count), this.blockLength)
      this.blockLength += count
      offset += count
      if (this.blockLength == CONTENT_HASH_BLOCK_SIZE) {
        await this.digestBufferedBlock()
      }
    }
  }

  /** The digests of every complete block so far, plus the trailing partial block once `digest` ran. */
  get blockHashes(): readonly Uint8Array[] {
    return this.hashes
  }

  /** Digests any trailing partial block, then returns the content hash as lowercase hex. */
  async digest(): Promise<string> {
    if (this.blockLength > 0) {
      await this.digestBufferedBlock()
    }
    const concatenated = new Uint8Array(this.hashes.length * SHA256_LENGTH)
    this.hashes.forEach((hash, index) => concatenated.set(hash, index * SHA256_LENGTH))
    return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', concatenated)))
  }

  private async digestBufferedBlock() {
    this.hashes.push(new Uint8Array(await crypto.subtle.digest('SHA-256', this.block!.subarray(0, this.blockLength))))
    this.blockLength = 0
  }
}

export async function contentHash(data: Uint8Array): Promise<string> {
  const hasher = new ContentHasher()
  await hasher.update(data)
  return hasher.digest()
}

export function toHex(bytes: Uint8Array): string {
  let hex = ''
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0')
  }
  return hex
}

export function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  if (hex.length % 2 != 0 || !/^[0-9a-f]*$/i.test(hex)) {
    throw new Error(`Invalid hex string: ${hex}`)
  }
  const bytes = new Uint8Array(hex.length / 2)
  for (let index = 0; index < bytes.length; ++index) {
    bytes[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}
