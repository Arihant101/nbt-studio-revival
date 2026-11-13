import type { Compression, NbtDocument, Tag } from './types'
import { TagType } from './types'
import { decodeMutf8, encodeMutf8 } from './mutf8'
import { MAX_DECOMPRESSED_BYTES, MAX_DEPTH, MAX_TAGS } from './limits'

// Binary NBT (Java Edition) reader/writer.
// Big-endian via DataView. Strings use Java's Modified UTF-8 (see mutf8.ts).
// Gzip and zlib are handled with the platform's DecompressionStream /
// CompressionStream (available in Node 18+ and all modern browsers).
//
// The reader treats its input as hostile: every length is checked against the
// bytes actually remaining BEFORE anything is allocated, nesting depth and
// total tag count are capped, and inflation is capped, so a crafted file fails
// fast with a clear message instead of exhausting memory or the call stack.

// --- compression helpers --------------------------------------------------

function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
}

/** zlib header: CMF 0x78 (deflate, 32K window) and a valid FCHECK. */
function isZlib(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x78 && ((bytes[0] << 8) | bytes[1]!) % 31 === 0
}

export function detectCompression(bytes: Uint8Array): Compression {
  if (isGzip(bytes)) return 'gzip'
  if (isZlib(bytes)) return 'zlib'
  return 'none'
}

function streamFormat(compression: Exclude<Compression, 'none'>): CompressionFormat {
  return compression === 'gzip' ? 'gzip' : 'deflate'
}

async function inflate(bytes: Uint8Array, compression: Exclude<Compression, 'none'>): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream(streamFormat(compression)))
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_DECOMPRESSED_BYTES) {
        await reader.cancel().catch(() => {})
        throw new Error(
          `Decompressed data exceeds ${MAX_DECOMPRESSED_BYTES / 1024 / 1024} MiB; refusing to load (possible decompression bomb)`,
        )
      }
      chunks.push(value)
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Decompressed data exceeds')) throw err
    throw new Error(`Corrupt or truncated ${compression} data: ${err instanceof Error && err.message ? err.message : 'decompression failed'}`)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

async function deflate(bytes: Uint8Array, compression: Exclude<Compression, 'none'>): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream(streamFormat(compression)))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

// --- reader ---------------------------------------------------------------

/** Smallest possible encoded payload per tag type, for pre-allocation checks. */
const MIN_PAYLOAD: Record<number, number> = {
  [TagType.Byte]: 1,
  [TagType.Short]: 2,
  [TagType.Int]: 4,
  [TagType.Long]: 8,
  [TagType.Float]: 4,
  [TagType.Double]: 8,
  [TagType.ByteArray]: 4,
  [TagType.String]: 2,
  [TagType.List]: 5,
  [TagType.Compound]: 1,
  [TagType.IntArray]: 4,
  [TagType.LongArray]: 4,
}

function isKnownType(type: number): type is TagType {
  return Number.isInteger(type) && type >= TagType.End && type <= TagType.LongArray
}

class Reader {
  private readonly view: DataView
  private readonly bytes: Uint8Array
  private offset = 0
  tags = 0

  constructor(bytes: Uint8Array) {
    this.bytes = bytes
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  get position(): number {
    return this.offset
  }

  get remaining(): number {
    return this.bytes.byteLength - this.offset
  }

  /** Throw a clear error unless `n` more bytes are available. */
  need(n: number): void {
    if (n > this.remaining) {
      throw new Error(
        `Unexpected end of data at byte ${this.offset}: needed ${n} more byte(s), only ${this.remaining} left (file truncated or corrupt)`,
      )
    }
  }

  countTag(): void {
    this.tags += 1
    if (this.tags > MAX_TAGS) {
      throw new Error(`File contains more than ${MAX_TAGS.toLocaleString('en-US')} tags; refusing to load`)
    }
  }

  readByte(): number {
    this.need(1)
    return this.view.getInt8(this.offset++)
  }

  readUint8(): number {
    this.need(1)
    return this.view.getUint8(this.offset++)
  }

  readShort(): number {
    this.need(2)
    const v = this.view.getInt16(this.offset, false)
    this.offset += 2
    return v
  }

  readUint16(): number {
    this.need(2)
    const v = this.view.getUint16(this.offset, false)
    this.offset += 2
    return v
  }

  readInt(): number {
    this.need(4)
    const v = this.view.getInt32(this.offset, false)
    this.offset += 4
    return v
  }

  readLong(): bigint {
    this.need(8)
    const v = this.view.getBigInt64(this.offset, false)
    this.offset += 8
    return v
  }

  readFloat(): number {
    this.need(4)
    const v = this.view.getFloat32(this.offset, false)
    this.offset += 4
    return v
  }

  readDouble(): number {
    this.need(8)
    const v = this.view.getFloat64(this.offset, false)
    this.offset += 8
    return v
  }

  /** Copy `length` bytes out (the copy owns its own buffer). */
  readBytes(length: number): Uint8Array {
    this.need(length)
    const out = this.bytes.slice(this.offset, this.offset + length)
    this.offset += length
    return out
  }

  readString(): string {
    const length = this.readUint16()
    this.need(length)
    const s = decodeMutf8(this.bytes.subarray(this.offset, this.offset + length))
    this.offset += length
    return s
  }

  /** Read a signed i32 element count and validate it against remaining bytes. */
  readCount(what: string, minBytesEach: number): number {
    const at = this.offset
    const count = this.readInt()
    if (count < 0) {
      throw new Error(`Negative ${what} length ${count} at byte ${at}`)
    }
    if (count * minBytesEach > this.remaining) {
      throw new Error(
        `${what} at byte ${at} claims ${count} element(s) but only ${this.remaining} byte(s) remain (file truncated or corrupt)`,
      )
    }
    return count
  }
}

function readPayload(reader: Reader, type: TagType, depth: number): Tag {
  reader.countTag()
  switch (type) {
    case TagType.Byte:
      return { type: TagType.Byte, value: reader.readByte() }
    case TagType.Short:
      return { type: TagType.Short, value: reader.readShort() }
    case TagType.Int:
      return { type: TagType.Int, value: reader.readInt() }
    case TagType.Long:
      return { type: TagType.Long, value: reader.readLong() }
    case TagType.Float:
      return { type: TagType.Float, value: reader.readFloat() }
    case TagType.Double:
      return { type: TagType.Double, value: reader.readDouble() }
    case TagType.ByteArray: {
      const count = reader.readCount('ByteArray', 1)
      const raw = reader.readBytes(count)
      return { type: TagType.ByteArray, value: new Int8Array(raw.buffer, raw.byteOffset, raw.byteLength) }
    }
    case TagType.String:
      return { type: TagType.String, value: reader.readString() }
    case TagType.List: {
      if (depth >= MAX_DEPTH) throw depthError(reader)
      const at = reader.position
      const elementType = reader.readUint8()
      if (!isKnownType(elementType)) {
        throw new Error(`Unknown List element type ${elementType} at byte ${at}`)
      }
      const count = reader.readCount('List', MIN_PAYLOAD[elementType] ?? 0)
      if (elementType === TagType.End && count > 0) {
        throw new Error(`List at byte ${at} has element type End but ${count} element(s)`)
      }
      const value: Tag[] = new Array<Tag>(count)
      for (let i = 0; i < count; i++) {
        value[i] = readPayload(reader, elementType, depth + 1)
      }
      return { type: TagType.List, elementType, value }
    }
    case TagType.Compound: {
      if (depth >= MAX_DEPTH) throw depthError(reader)
      const value = new Map<string, Tag>()
      for (;;) {
        const at = reader.position
        const childType = reader.readUint8()
        if (childType === TagType.End) break
        if (!isKnownType(childType)) {
          throw new Error(`Unknown NBT tag type ${childType} at byte ${at}`)
        }
        const name = reader.readString()
        value.set(name, readPayload(reader, childType, depth + 1))
      }
      return { type: TagType.Compound, value }
    }
    case TagType.IntArray: {
      const count = reader.readCount('IntArray', 4)
      const out = new Int32Array(count)
      for (let i = 0; i < count; i++) out[i] = reader.readInt()
      return { type: TagType.IntArray, value: out }
    }
    case TagType.LongArray: {
      const count = reader.readCount('LongArray', 8)
      const out = new BigInt64Array(count)
      for (let i = 0; i < count; i++) out[i] = reader.readLong()
      return { type: TagType.LongArray, value: out }
    }
    case TagType.End:
      throw new Error(`Unexpected End tag in payload position at byte ${reader.position}`)
    default:
      throw new Error(`Unknown NBT tag type: ${type as number}`)
  }
}

function depthError(reader: Reader): Error {
  return new Error(`NBT nesting deeper than ${MAX_DEPTH} levels at byte ${reader.position}; refusing to load`)
}

// --- writer ---------------------------------------------------------------

class Writer {
  private buffer = new Uint8Array(1024)
  private view = new DataView(this.buffer.buffer)
  private offset = 0

  private ensure(extra: number): void {
    const needed = this.offset + extra
    if (needed <= this.buffer.byteLength) return
    let next = this.buffer.byteLength * 2
    while (next < needed) next *= 2
    const grown = new Uint8Array(next)
    grown.set(this.buffer.subarray(0, this.offset))
    this.buffer = grown
    this.view = new DataView(this.buffer.buffer)
  }

  writeByte(v: number): void {
    this.ensure(1)
    this.view.setInt8(this.offset, v)
    this.offset += 1
  }

  writeUint8(v: number): void {
    this.ensure(1)
    this.view.setUint8(this.offset, v)
    this.offset += 1
  }

  writeShort(v: number): void {
    this.ensure(2)
    this.view.setInt16(this.offset, v, false)
    this.offset += 2
  }

  writeUint16(v: number): void {
    this.ensure(2)
    this.view.setUint16(this.offset, v, false)
    this.offset += 2
  }

  writeInt(v: number): void {
    this.ensure(4)
    this.view.setInt32(this.offset, v, false)
    this.offset += 4
  }

  writeLong(v: bigint): void {
    this.ensure(8)
    this.view.setBigInt64(this.offset, v, false)
    this.offset += 8
  }

  writeFloat(v: number): void {
    this.ensure(4)
    this.view.setFloat32(this.offset, v, false)
    this.offset += 4
  }

  writeDouble(v: number): void {
    this.ensure(8)
    this.view.setFloat64(this.offset, v, false)
    this.offset += 8
  }

  writeBytes(bytes: Uint8Array): void {
    this.ensure(bytes.byteLength)
    this.buffer.set(bytes, this.offset)
    this.offset += bytes.byteLength
  }

  writeString(value: string): void {
    const encoded = encodeMutf8(value)
    this.writeUint16(encoded.byteLength)
    this.writeBytes(encoded)
  }

  finish(): Uint8Array {
    return this.buffer.slice(0, this.offset)
  }
}

const INT_RANGES = {
  [TagType.Byte]: [-128, 127, 'Byte'],
  [TagType.Short]: [-32768, 32767, 'Short'],
  [TagType.Int]: [-2147483648, 2147483647, 'Int'],
} as const

const I64_MIN = -(2n ** 63n)
const I64_MAX = 2n ** 63n - 1n

/** Refuse to silently wrap an out-of-range integer into a corrupt file. */
function checkInt(type: keyof typeof INT_RANGES, value: number): void {
  const [min, max, name] = INT_RANGES[type]
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} value ${value} is not an integer in [${min}, ${max}]`)
  }
}

function writePayload(writer: Writer, tag: Tag, depth: number): void {
  switch (tag.type) {
    case TagType.Byte:
      checkInt(TagType.Byte, tag.value)
      writer.writeByte(tag.value)
      break
    case TagType.Short:
      checkInt(TagType.Short, tag.value)
      writer.writeShort(tag.value)
      break
    case TagType.Int:
      checkInt(TagType.Int, tag.value)
      writer.writeInt(tag.value)
      break
    case TagType.Long:
      if (tag.value < I64_MIN || tag.value > I64_MAX) {
        throw new Error(`Long value ${tag.value} is out of range for i64`)
      }
      writer.writeLong(tag.value)
      break
    case TagType.Float:
      writer.writeFloat(tag.value)
      break
    case TagType.Double:
      writer.writeDouble(tag.value)
      break
    case TagType.ByteArray:
      writer.writeInt(tag.value.length)
      writer.writeBytes(new Uint8Array(tag.value.buffer, tag.value.byteOffset, tag.value.byteLength))
      break
    case TagType.String:
      writer.writeString(tag.value)
      break
    case TagType.List: {
      if (depth >= MAX_DEPTH) throw new Error(`NBT nesting deeper than ${MAX_DEPTH} levels`)
      // The declared elementType is the single source of truth for the
      // element-type byte, so every element MUST match it or the file is
      // unreadable. Empty lists may keep any declared type (vanilla uses End).
      if (tag.value.length > 0 && tag.elementType === TagType.End) {
        throw new Error('Non-empty List cannot have element type End')
      }
      for (const child of tag.value) {
        if (child.type !== tag.elementType) {
          throw new Error(
            `List declares element type ${tag.elementType} but contains a tag of type ${child.type}; NBT lists must be homogeneous`,
          )
        }
      }
      writer.writeUint8(tag.elementType)
      writer.writeInt(tag.value.length)
      for (const child of tag.value) writePayload(writer, child, depth + 1)
      break
    }
    case TagType.Compound:
      if (depth >= MAX_DEPTH) throw new Error(`NBT nesting deeper than ${MAX_DEPTH} levels`)
      for (const [name, child] of tag.value) {
        writer.writeUint8(child.type)
        writer.writeString(name)
        writePayload(writer, child, depth + 1)
      }
      writer.writeUint8(TagType.End)
      break
    case TagType.IntArray:
      writer.writeInt(tag.value.length)
      for (let i = 0; i < tag.value.length; i++) writer.writeInt(tag.value[i]!)
      break
    case TagType.LongArray:
      writer.writeInt(tag.value.length)
      for (let i = 0; i < tag.value.length; i++) writer.writeLong(tag.value[i]!)
      break
    default: {
      const exhaustive: never = tag
      throw new Error(`Unknown NBT tag type: ${(exhaustive as { type: unknown }).type}`)
    }
  }
}

// --- public API -----------------------------------------------------------

export async function parseBinary(bytes: Uint8Array): Promise<NbtDocument> {
  const compression = detectCompression(bytes)
  const raw = compression === 'none' ? bytes : await inflate(bytes, compression)

  if (raw.byteLength === 0) throw new Error('File is empty')
  const reader = new Reader(raw)
  const rootType = reader.readUint8()
  if (rootType !== TagType.Compound) {
    throw new Error(`Not an NBT file: expected root Compound tag (10), got ${rootType}`)
  }
  const name = reader.readString()
  const root = readPayload(reader, TagType.Compound, 0)
  if (root.type !== TagType.Compound) {
    throw new Error('Root payload was not a Compound')
  }
  return { name, root, compression }
}

export async function serializeBinary(doc: NbtDocument): Promise<Uint8Array> {
  const writer = new Writer()
  writer.writeUint8(TagType.Compound)
  writer.writeString(doc.name)
  writePayload(writer, doc.root, 0)
  const raw = writer.finish()
  return doc.compression === 'none' ? raw : deflate(raw, doc.compression)
}
