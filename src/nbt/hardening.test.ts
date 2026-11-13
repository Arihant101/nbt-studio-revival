// Regression tests for malformed / hostile input and silent-corruption bugs
// found in the post-Kiro audit. Each case used to crash the tab, hang, or
// write a file Minecraft could not read.
import { describe, expect, it } from 'vitest'
import { parseBinary, serializeBinary } from './binary'
import { parseSnbt, serializeSnbt } from './snbt'
import { decodeMutf8, encodeMutf8 } from './mutf8'
import { MAX_DEPTH } from './limits'
import type { NbtDocument, Tag } from './types'
import { TagType } from './types'

function docWith(tag: Tag, compression: NbtDocument['compression'] = 'none'): NbtDocument {
  return { name: '', compression, root: { type: TagType.Compound, value: new Map([['x', tag]]) } }
}

async function roundTrip(tag: Tag, compression: NbtDocument['compression'] = 'none'): Promise<Tag> {
  const doc = await parseBinary(await serializeBinary(docWith(tag, compression)))
  return doc.root.value.get('x')!
}

describe('Modified UTF-8 strings', () => {
  it('encodes NUL as C0 80 and emoji as two 3-byte surrogates (Java format)', () => {
    expect(Array.from(encodeMutf8('\u0000'))).toEqual([0xc0, 0x80])
    // U+1F600 => surrogates D83D DE00 => ED A0 BD ED B8 80
    expect(Array.from(encodeMutf8('😀'))).toEqual([0xed, 0xa0, 0xbd, 0xed, 0xb8, 0x80])
  })

  it('round-trips NUL, emoji and CJK through binary', async () => {
    const value = 'a\u0000b😀你好é'
    expect(await roundTrip({ type: TagType.String, value })).toEqual({ type: TagType.String, value })
  })

  it('still reads standard 4-byte UTF-8 from third-party tools', () => {
    expect(decodeMutf8(new Uint8Array([0xf0, 0x9f, 0x98, 0x80]))).toBe('😀')
  })

  it('maps malformed bytes to U+FFFD instead of throwing', () => {
    expect(decodeMutf8(new Uint8Array([0x41, 0xff, 0x42]))).toBe('A�B')
  })

  it('refuses to write a string over 65535 bytes instead of corrupting the file', async () => {
    await expect(serializeBinary(docWith({ type: TagType.String, value: 'x'.repeat(70000) }))).rejects.toThrow(
      /too long/,
    )
    // Exactly at the limit is fine.
    const max = 'y'.repeat(65535)
    expect(await roundTrip({ type: TagType.String, value: max })).toEqual({ type: TagType.String, value: max })
  })
})

describe('binary reader rejects hostile input cleanly', () => {
  it('reports truncation with a readable message', async () => {
    await expect(parseBinary(new Uint8Array([10, 0, 0, 3, 0, 1, 97, 0]))).rejects.toThrow(/Unexpected end of data/)
  })

  it('does not allocate for a huge claimed array length', async () => {
    // ByteArray claiming 2^31-1 elements with no data behind it.
    await expect(parseBinary(new Uint8Array([10, 0, 0, 7, 0, 0, 0x7f, 0xff, 0xff, 0xff]))).rejects.toThrow(
      /claims 2147483647/,
    )
    // List of Longs claiming 1e9 elements.
    await expect(
      parseBinary(new Uint8Array([10, 0, 0, 9, 0, 0, 4, 0x3b, 0x9a, 0xca, 0x00, 0])),
    ).rejects.toThrow(/claims/)
  })

  it('rejects negative lengths', async () => {
    await expect(parseBinary(new Uint8Array([10, 0, 0, 7, 0, 0, 0xff, 0xff, 0xff, 0xff]))).rejects.toThrow(/Negative/)
    await expect(parseBinary(new Uint8Array([10, 0, 0, 9, 0, 0, 1, 0xff, 0xff, 0xff, 0xff, 0]))).rejects.toThrow(
      /Negative/,
    )
  })

  it('rejects unknown tag types and End-typed lists with elements', async () => {
    await expect(parseBinary(new Uint8Array([10, 0, 0, 99, 0, 0, 0]))).rejects.toThrow(/Unknown NBT tag type 99/)
    await expect(parseBinary(new Uint8Array([10, 0, 0, 9, 0, 0, 0, 0, 0, 0, 1, 0]))).rejects.toThrow(/End/)
  })

  it('caps nesting depth instead of overflowing the stack', async () => {
    const n = 100_000
    const bytes: number[] = [10, 0, 0]
    for (let i = 0; i < n; i++) bytes.push(10, 0, 0)
    for (let i = 0; i <= n; i++) bytes.push(0)
    await expect(parseBinary(new Uint8Array(bytes))).rejects.toThrow(/deeper than 512/)
  })

  it('accepts nesting right at the limit', async () => {
    const n = MAX_DEPTH - 1
    const bytes: number[] = [10, 0, 0]
    for (let i = 0; i < n; i++) bytes.push(10, 0, 0)
    for (let i = 0; i <= n; i++) bytes.push(0)
    await expect(parseBinary(new Uint8Array(bytes))).resolves.toBeDefined()
  })

  it('reports corrupt gzip clearly', async () => {
    await expect(parseBinary(new Uint8Array([0x1f, 0x8b, 1, 2, 3]))).rejects.toThrow(/Corrupt or truncated gzip/)
  })

  it('rejects empty and non-NBT input', async () => {
    await expect(parseBinary(new Uint8Array([]))).rejects.toThrow(/empty/)
    await expect(parseBinary(new TextEncoder().encode('hello'))).rejects.toThrow(/Not an NBT file/)
  })
})

describe('compression', () => {
  it('round-trips zlib-compressed NBT and keeps the compression', async () => {
    const original = docWith({ type: TagType.Int, value: 42 }, 'zlib')
    const bytes = await serializeBinary(original)
    expect(bytes[0]).toBe(0x78)
    const parsed = await parseBinary(bytes)
    expect(parsed.compression).toBe('zlib')
    expect(parsed.root.value.get('x')).toEqual({ type: TagType.Int, value: 42 })
  })
})

describe('writer refuses to emit corrupt files', () => {
  it('rejects a heterogeneous List', async () => {
    const bad: Tag = {
      type: TagType.List,
      elementType: TagType.Int,
      value: [
        { type: TagType.Int, value: 1 },
        { type: TagType.String, value: 'a' },
      ],
    }
    await expect(serializeBinary(docWith(bad))).rejects.toThrow(/homogeneous/)
  })

  it('rejects out-of-range integers instead of wrapping', async () => {
    await expect(serializeBinary(docWith({ type: TagType.Byte, value: 200 }))).rejects.toThrow(/Byte value 200/)
    await expect(serializeBinary(docWith({ type: TagType.Long, value: 2n ** 63n }))).rejects.toThrow(/i64/)
  })

  it('round-trips large byte arrays exactly', async () => {
    const value = new Int8Array(100_000).map((_, i) => (i % 256) - 128)
    expect(await roundTrip({ type: TagType.ByteArray, value }, 'gzip')).toEqual({ type: TagType.ByteArray, value })
  })
})

describe('SNBT hardening', () => {
  it('rejects mixed-type lists that could never be saved as binary', () => {
    expect(() => parseSnbt('[1,"a"]')).toThrow(/share one type/)
    expect(parseSnbt('[1,2]')).toMatchObject({ type: TagType.List, elementType: TagType.Int })
  })

  it('caps nesting depth instead of overflowing the stack', () => {
    expect(() => parseSnbt('['.repeat(100_000) + ']'.repeat(100_000))).toThrow(/deeper than 512/)
  })

  it('reports out-of-range literals with a position', () => {
    expect(() => parseSnbt('{a:1,b:999b}')).toThrow(/out of range.*at position 7/)
  })

  it('keeps the sign of negative zero', () => {
    const text = serializeSnbt({ type: TagType.Double, value: -0 })
    expect(Object.is((parseSnbt(text) as { value: number }).value, -0)).toBe(true)
  })

  it('prints floats in their shortest exact form', () => {
    expect(serializeSnbt({ type: TagType.Float, value: Math.fround(0.1) })).toBe('0.1f')
    const f = Math.fround(3.14159)
    expect(parseSnbt(serializeSnbt({ type: TagType.Float, value: f }))).toEqual({ type: TagType.Float, value: f })
  })
})
