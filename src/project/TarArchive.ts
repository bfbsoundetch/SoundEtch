export interface TarSourceEntry {
  readonly name: string
  readonly data: Blob
}

export interface TarEntry {
  readonly name: string
  readonly data: Blob
}

export interface TarOutput {
  write(data: Uint8Array<ArrayBuffer>): Promise<void>
}

interface TarPathFields {
  readonly name: string
  readonly prefix: string
}

const BLOCK_SIZE = 512
const END_BLOCKS = new Uint8Array(BLOCK_SIZE * 2)
const MAX_PAX_HEADER_SIZE = 1024 * 1024
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder('utf-8', { fatal: true })

export class TarArchive {
  static async write(entries: readonly TarSourceEntry[], output: TarOutput): Promise<void> {
    const entryNames = new Set<string>()

    for (let index = 0; index < entries.length; ++index) {
      const entry = entries[index]
      validateEntryName(entry.name)
      if (entryNames.has(entry.name)) {
        throw new Error(`Duplicate project archive entry: ${entry.name}`)
      }
      entryNames.add(entry.name)
      if (!Number.isSafeInteger(entry.data.size)) {
        throw new Error(`Project archive file is too large: ${entry.name}`)
      }

      const pathFields = getTarPathFields(entry.name)
      const modificationTime =
        typeof File != 'undefined' && entry.data instanceof File
          ? Math.floor(entry.data.lastModified / 1000)
          : Math.floor(Date.now() / 1000)
      if (!pathFields) {
        const paxData = createPaxPathRecord(entry.name)
        const paxHeader = createTarHeader(
          { name: `PaxHeaders/${index}`, prefix: '' },
          paxData.byteLength,
          modificationTime,
          'x',
        )
        await output.write(paxHeader)
        await output.write(paxData)
        await writePadding(paxData.byteLength, output)
      }

      const header = createTarHeader(
        pathFields ?? { name: `entry-${index}`, prefix: '' },
        entry.data.size,
        modificationTime,
        '0',
      )
      await output.write(header)
      await pipeBlob(entry.data, output)
      await writePadding(entry.data.size, output)
    }

    await output.write(END_BLOCKS)
  }

  static async read(archive: Blob): Promise<ReadonlyMap<string, TarEntry>> {
    const result = new Map<string, TarEntry>()
    let offset = 0
    let pendingPaxPath: string | null = null

    while (offset + BLOCK_SIZE <= archive.size) {
      const header = new Uint8Array(await archive.slice(offset, offset + BLOCK_SIZE).arrayBuffer())
      if (header.every((byte) => byte == 0)) {
        if (pendingPaxPath) {
          throw new Error('The project archive ends after an extended path header')
        }
        return result
      }
      validateHeaderChecksum(header)

      const size = readTarNumber(header.subarray(124, 136), 'file size')
      const type = String.fromCharCode(header[156] || 48)
      const dataOffset = offset + BLOCK_SIZE
      const dataEnd = dataOffset + size
      const nextHeaderOffset = dataEnd + getPaddingSize(size)
      if (!Number.isSafeInteger(nextHeaderOffset) || nextHeaderOffset > archive.size) {
        throw new Error('The project archive contains a truncated file')
      }

      if (type == 'x') {
        if (size > MAX_PAX_HEADER_SIZE) {
          throw new Error('The project archive contains an oversized extended header')
        }
        const paxData = new Uint8Array(await archive.slice(dataOffset, dataEnd).arrayBuffer())
        pendingPaxPath = readPaxPath(paxData)
      } else if (type == '0') {
        const headerPath = readHeaderPath(header)
        const name = pendingPaxPath ?? headerPath
        pendingPaxPath = null
        validateEntryName(name)
        if (result.has(name)) {
          throw new Error(`Duplicate project archive entry: ${name}`)
        }
        result.set(name, { name, data: archive.slice(dataOffset, dataEnd) })
      } else {
        throw new Error(`Unsupported TAR entry type: ${type}`)
      }

      offset = nextHeaderOffset
    }

    throw new Error('The selected file is not a complete TAR archive')
  }

  static async readEntry(entry: TarEntry, maximumSize: number): Promise<Uint8Array<ArrayBuffer>> {
    if (entry.data.size > maximumSize) {
      throw new Error(`Project archive entry is too large: ${entry.name}`)
    }
    return new Uint8Array(await entry.data.arrayBuffer())
  }

  static async pipeEntry(entry: TarEntry, write: (data: Uint8Array<ArrayBuffer>) => Promise<void>): Promise<void> {
    const output: TarOutput = { write }
    await pipeBlob(entry.data, output)
  }
}

function createTarHeader(path: TarPathFields, size: number, modificationTime: number, type: '0' | 'x') {
  const header = new Uint8Array(BLOCK_SIZE)
  writeText(header, 0, 100, path.name)
  writeTarNumber(header, 100, 8, 0o644)
  writeTarNumber(header, 108, 8, 0)
  writeTarNumber(header, 116, 8, 0)
  writeTarNumber(header, 124, 12, size)
  writeTarNumber(header, 136, 12, modificationTime)
  header.fill(32, 148, 156)
  header[156] = type.charCodeAt(0)
  writeText(header, 257, 6, 'ustar\0')
  writeText(header, 263, 2, '00')
  writeText(header, 265, 32, 'soundetch')
  writeText(header, 297, 32, 'soundetch')
  writeText(header, 345, 155, path.prefix)

  let checksum = 0
  for (const byte of header) {
    checksum += byte
  }
  writeText(header, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `)
  return header
}

function getTarPathFields(path: string): TarPathFields | null {
  if (textEncoder.encode(path).byteLength <= 100) {
    return { name: path, prefix: '' }
  }

  for (let slash = path.lastIndexOf('/'); slash > 0; slash = path.lastIndexOf('/', slash - 1)) {
    const prefix = path.slice(0, slash)
    const name = path.slice(slash + 1)
    if (textEncoder.encode(prefix).byteLength <= 155 && textEncoder.encode(name).byteLength <= 100) {
      return { name, prefix }
    }
  }
  return null
}

function createPaxPathRecord(path: string): Uint8Array<ArrayBuffer> {
  const payload = `path=${path}\n`
  let recordLength = textEncoder.encode(`0 ${payload}`).byteLength
  for (;;) {
    const record = textEncoder.encode(`${recordLength} ${payload}`)
    if (record.byteLength == recordLength) {
      return record
    }
    recordLength = record.byteLength
  }
}

function readPaxPath(data: Uint8Array): string {
  let offset = 0
  let path: string | null = null
  while (offset < data.byteLength) {
    const separator = data.indexOf(32, offset)
    if (separator < 0) {
      throw new Error('The project archive contains an invalid extended header')
    }
    const lengthText = textDecoder.decode(data.subarray(offset, separator))
    const recordLength = Number(lengthText)
    const recordEnd = offset + recordLength
    if (!Number.isSafeInteger(recordLength) || recordLength <= separator - offset + 1 || recordEnd > data.byteLength) {
      throw new Error('The project archive contains an invalid extended header length')
    }
    const record = textDecoder.decode(data.subarray(separator + 1, recordEnd))
    if (!record.endsWith('\n')) {
      throw new Error('The project archive contains an invalid extended header record')
    }
    const assignment = record.slice(0, -1)
    const equals = assignment.indexOf('=')
    if (equals <= 0) {
      throw new Error('The project archive contains an invalid extended header value')
    }
    if (assignment.slice(0, equals) == 'path') {
      path = assignment.slice(equals + 1)
    }
    offset = recordEnd
  }
  if (!path) {
    throw new Error('The project archive extended header is missing its path')
  }
  return path
}

function readHeaderPath(header: Uint8Array): string {
  const name = readText(header.subarray(0, 100))
  const prefix = readText(header.subarray(345, 500))
  return prefix ? `${prefix}/${name}` : name
}

function validateHeaderChecksum(header: Uint8Array): void {
  const storedChecksum = readOctal(header.subarray(148, 156), 'header checksum')
  let calculatedChecksum = 0
  for (let index = 0; index < header.byteLength; ++index) {
    calculatedChecksum += index >= 148 && index < 156 ? 32 : header[index]
  }
  if (storedChecksum != calculatedChecksum) {
    throw new Error('The project archive contains an invalid TAR header checksum')
  }
}

function readTarNumber(field: Uint8Array, label: string): number {
  if ((field[0] & 0x80) == 0) {
    return readOctal(field, label)
  }
  if ((field[0] & 0x40) != 0) {
    throw new Error(`The project archive contains a negative ${label}`)
  }

  let value = BigInt(field[0] & 0x3f)
  for (let index = 1; index < field.byteLength; ++index) {
    value = (value << 8n) | BigInt(field[index])
  }
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`The project archive ${label} is too large`)
  }
  return Number(value)
}

function readOctal(field: Uint8Array, label: string): number {
  const text = new TextDecoder('ascii')
    .decode(field)
    .replace(/[\0 ]+$/g, '')
    .trimStart()
  if (!/^[0-7]+$/.test(text)) {
    throw new Error(`The project archive contains an invalid ${label}`)
  }
  const value = Number.parseInt(text, 8)
  if (!Number.isSafeInteger(value)) {
    throw new Error(`The project archive ${label} is too large`)
  }
  return value
}

function writeTarNumber(header: Uint8Array, offset: number, length: number, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('TAR numeric value is outside the supported range')
  }
  const octal = value.toString(8)
  if (octal.length < length) {
    writeText(header, offset, length, `${octal.padStart(length - 1, '0')}\0`)
    return
  }

  let remaining = BigInt(value)
  for (let index = offset + length - 1; index >= offset; --index) {
    header[index] = Number(remaining & 0xffn)
    remaining >>= 8n
  }
  if (remaining != 0n || (header[offset] & 0x80) != 0) {
    throw new Error('TAR numeric value is too large')
  }
  header[offset] |= 0x80
}

function writeText(target: Uint8Array, offset: number, length: number, value: string): void {
  const encoded = textEncoder.encode(value)
  if (encoded.byteLength > length) {
    throw new Error(`TAR text field is too long: ${value}`)
  }
  target.set(encoded, offset)
}

function readText(field: Uint8Array): string {
  const end = field.indexOf(0)
  return textDecoder.decode(end < 0 ? field : field.subarray(0, end))
}

async function pipeBlob(data: Blob, output: TarOutput): Promise<void> {
  const reader = data.stream().getReader()
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) {
        return
      }
      await output.write(chunk.value)
    }
  } finally {
    reader.releaseLock()
  }
}

async function writePadding(size: number, output: TarOutput): Promise<void> {
  const paddingSize = getPaddingSize(size)
  if (paddingSize > 0) {
    await output.write(new Uint8Array(paddingSize))
  }
}

function getPaddingSize(size: number): number {
  return (BLOCK_SIZE - (size % BLOCK_SIZE)) % BLOCK_SIZE
}

function validateEntryName(name: string): void {
  const pathSegments = name.split('/')
  if (
    !name ||
    name.startsWith('/') ||
    name.includes('\\') ||
    name.includes('\0') ||
    pathSegments.some((pathSegment) => !pathSegment || pathSegment == '.' || pathSegment == '..')
  ) {
    throw new Error(`Invalid project archive path: ${name}`)
  }
}
