import { expect, test } from 'vitest'
import { amzDate, canonicalQuery, encodeS3Path, sha256Hex, signS3Request } from './S3Signer'

// The examples in https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html
const credentials = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
}
const date = new Date('2013-05-24T00:00:00Z')
const emptyHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

async function sign(
  path: string,
  query: ReadonlyArray<readonly [string, string]>,
  options: { method?: string; headers?: Record<string, string>; payloadHash?: string } = {},
) {
  const payloadHash = options.payloadHash ?? emptyHash
  return signS3Request(
    {
      method: options.method ?? 'GET',
      host: 'examplebucket.s3.amazonaws.com',
      path,
      query: canonicalQuery(query),
      headers: { ...options.headers, 'x-amz-date': amzDate(date), 'x-amz-content-sha256': payloadHash },
      payloadHash,
    },
    credentials,
    date,
  )
}

test('signatures match the AWS examples', async () => {
  const scope = 'Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request'
  expect(await sign(encodeS3Path('test.txt'), [], { headers: { range: 'bytes=0-9' } })).toBe(
    `AWS4-HMAC-SHA256 ${scope}, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41`,
  )

  const body = new TextEncoder().encode('Welcome to Amazon S3.')
  expect(
    await sign(encodeS3Path('test$file.text'), [], {
      method: 'PUT',
      headers: { date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-storage-class': 'REDUCED_REDUNDANCY' },
      payloadHash: await sha256Hex(body),
    }),
  ).toBe(
    `AWS4-HMAC-SHA256 ${scope}, SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class, Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd`,
  )

  expect(await sign('/', [['lifecycle', '']])).toBe(
    `AWS4-HMAC-SHA256 ${scope}, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543`,
  )

  expect(
    await sign('/', [
      ['prefix', 'J'],
      ['max-keys', '2'],
    ]),
  ).toBe(
    `AWS4-HMAC-SHA256 ${scope}, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7`,
  )
})

test('paths keep slashes and encode everything else; query values encode slashes too', () => {
  expect(encodeS3Path('bucket', 'My Song (2) 2026-11-18T10-00-00/opfs/12_summary')).toBe(
    '/bucket/My%20Song%20%282%29%202026-11-18T10-00-00/opfs/12_summary',
  )
  expect(encodeS3Path('Café ü')).toBe('/Caf%C3%A9%20%C3%BC')
  expect(
    canonicalQuery([
      ['prefix', 'soundetch/a b/'],
      ['list-type', '2'],
      ['delimiter', '/'],
    ]),
  ).toBe('delimiter=%2F&list-type=2&prefix=soundetch%2Fa%20b%2F')
})
