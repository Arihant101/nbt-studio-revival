import type { NbtDocument, Tag } from './types'
import { TagType } from './types'

// Binary NBT (Java Edition) reader/writer.
// Big-endian via DataView. Gzip handled with the platform's
// DecompressionStream / CompressionStream (available in Node 18+ and browsers).
//
// TODO(nbt): Strings use standard UTF-8 via TextEncoder/TextDecoder. The NBT
// format technically uses Modified UTF-8 (NUL encoded as 0xC0 0x80, and
// 4-byte code points as surrogate-pair CESU-8). Full Modified UTF-8
// correctness is deferred; plain UTF-8 is correct for all code points except
// embedded NUL and characters outside the BMP.

const GZIP_MAGIC_0 = 0x1f
const GZIP_MAGIC_1 = 0x8b

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder('utf-8', { fatal: false })

// --- gzip helpers ---------------------------------------------------------

function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === GZIP_MAGIC_0 && bytes[1] === GZIP_MAGIC_1
}

async function streamToBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const buf = await new Response(stream).arrayBuffer()
  return new Uint8Array(buf)
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('gzip')
  const input = new Blob([bytes as BlobPart]).stream().pipeThrough(ds)
  return streamToBytes(input)
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('gzip')
  const input = new Blob([bytes as BlobPart]).stream().pipeThrough(cs)
  return streamToBytes(input)
}

// --- reader ---------------------------------------------------------------

class Reader {
  private readonly view: DataView
  private offset = 0

  constructor(bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  readByte(): number {
    const v = this.view.getInt8(this.offset)
    this.offset += 1
    return v
  }

  readUint8(): number {
    const v = this.view.getUint8(this.offset)
    this.offset += 1
    return v
  }

  readShort(): number {
    const v = this.view.getInt16(this.offset, false)
    this.offset += 2
    return v
  }

  readUint16(): number {
    const v = this.view.getUint16(this.offset, false)
    this.offset += 2
    return v
  }

  readInt(): number {
    const v = this.view.getInt32(this.offset, false)
    this.offset += 4
    return v
  }

  readLong(): bigint {
    const v = this.view.getBigInt64(this.offset, false)
    this.offset += 8
    return v
  }

  readFloat(): number {
    const v = this.view.getFloat32(this.offset, false)
    this.offset += 4
    return v
  }

  readDouble(): number {
    const v = this.view.getFloat64(this.offset, false)
    this.offset += 8
    return v
  }

  readBytes(length: number): Uint8Array {
    const start = this.view.byteOffset + this.offset
    const out = new Uint8Array(this.view.buffer.slice(start, start + length))
    this.offset += length
    return out
  }

  readString(): string {
    const length = this.readUint16()
    const raw = this.readBytes(length)
    return textDecoder.decode(raw)
  }
}

function readPayload(reader: Reader, type: TagType): Tag {
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
      const count = reader.readInt()
      const out = new Int8Array(count)
      for (let i = 0; i < count; i++) out[i] = reader.readByte()
      return { type: TagType.ByteArray, value: out }
    }
    case TagType.String:
      return { type: TagType.String, value: reader.readString() }
    case TagType.List: {
      const elementType = reader.readUint8() as TagType
      const count = reader.readInt()
      const value: Tag[] = []
      for (let i = 0; i < count; i++) {
        value.push(readPayload(reader, elementType))
      }
      return { type: TagType.List, elementType, value }
    }
    case TagType.Compound: {
      const value = new Map<string, Tag>()
      for (;;) {
        const childType = reader.readUint8() as TagType
        if (childType === TagType.End) break
        const name = reader.readString()
        value.set(name, readPayload(reader, childType))
      }
      return { type: TagType.Compound, value }
    }
    case TagType.IntArray: {
      const count = reader.readInt()
      const out = new Int32Array(count)
      for (let i = 0; i < count; i++) out[i] = reader.readInt()
      return { type: TagType.IntArray, value: out }
    }
    case TagType.LongArray: {
      const count = reader.readInt()
      const out = new BigInt64Array(count)
      for (let i = 0; i < count; i++) out[i] = reader.readLong()
      return { type: TagType.LongArray, value: out }
    }
    case TagType.End:
      throw new Error('Unexpected End tag in payload position')
    default:
      throw new Error(`Unknown NBT tag type: ${type as number}`)
  }
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
    const encoded = textEncoder.encode(value)
    this.writeUint16(encoded.byteLength)
    this.writeBytes(encoded)
  }

  finish(): Uint8Array {
    return this.buffer.slice(0, this.offset)
  }
}

function writePayload(writer: Writer, tag: Tag): void {
  switch (tag.type) {
    case TagType.Byte:
      writer.writeByte(tag.value)
      break
    case TagType.Short:
      writer.writeShort(tag.value)
      break
    case TagType.Int:
      writer.writeInt(tag.value)
      break
    case TagType.Long:
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
      for (let i = 0; i < tag.value.length; i++) writer.writeByte(tag.value[i])
      break
    case TagType.String:
      writer.writeString(tag.value)
      break
    case TagType.List: {
      // The declared elementType is the single source of truth for the
      // element-type byte. Empty lists conventionally use End (0); the
      // element payloads themselves are written from tag.value below.
      writer.writeUint8(tag.elementType)
      writer.writeInt(tag.value.length)
      for (const child of tag.value) writePayload(writer, child)
      break
    }
    case TagType.Compound:
      for (const [name, child] of tag.value) {
        writer.writeUint8(child.type)
        writer.writeString(name)
        writePayload(writer, child)
      }
      writer.writeUint8(TagType.End)
      break
    case TagType.IntArray:
      writer.writeInt(tag.value.length)
      for (let i = 0; i < tag.value.length; i++) writer.writeInt(tag.value[i])
      break
    case TagType.LongArray:
      writer.writeInt(tag.value.length)
      for (let i = 0; i < tag.value.length; i++) writer.writeLong(tag.value[i])
      break
    default: {
      const exhaustive: never = tag
      throw new Error(`Unknown NBT tag: ${JSON.stringify(exhaustive)}`)
    }
  }
}

// --- public API -----------------------------------------------------------

export async function parseBinary(bytes: Uint8Array): Promise<NbtDocument> {
  const compression: 'none' | 'gzip' = isGzip(bytes) ? 'gzip' : 'none'
  const raw = compression === 'gzip' ? await gunzip(bytes) : bytes

  const reader = new Reader(raw)
  const rootType = reader.readUint8() as TagType
  if (rootType !== TagType.Compound) {
    throw new Error(`Expected root Compound tag (10), got ${rootType as number}`)
  }
  const name = reader.readString()
  const root = readPayload(reader, TagType.Compound)
  if (root.type !== TagType.Compound) {
    throw new Error('Root payload was not a Compound')
  }
  return { name, root, compression }
}

export async function serializeBinary(doc: NbtDocument): Promise<Uint8Array> {
  const writer = new Writer()
  writer.writeUint8(TagType.Compound)
  writer.writeString(doc.name)
  writePayload(writer, doc.root)
  const raw = writer.finish()
  return doc.compression === 'gzip' ? gzip(raw) : raw
}
