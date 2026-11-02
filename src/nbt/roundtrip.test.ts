import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

import { parseBinary, serializeBinary } from './binary'
import { parseSnbt, serializeSnbt } from './snbt'
import type { NbtDocument, Tag } from './types'
import { TagType } from './types'

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const LEVEL_DAT = join(FIXTURE_DIR, 'level.dat')

// A document exercising every NBT tag type: all scalars, both signedness
// extremes for ints/longs, every array type, a list of ints, an empty list,
// a list of compounds, and nested compounds.
function sampleDocument(compression: 'none' | 'gzip'): NbtDocument {
  const root: Extract<Tag, { type: typeof TagType.Compound }> = {
    type: TagType.Compound,
    value: new Map<string, Tag>([
      ['byteTag', { type: TagType.Byte, value: -7 }],
      ['byteMax', { type: TagType.Byte, value: 127 }],
      ['byteMin', { type: TagType.Byte, value: -128 }],
      ['shortTag', { type: TagType.Short, value: 1234 }],
      ['shortMin', { type: TagType.Short, value: -32768 }],
      ['intTag', { type: TagType.Int, value: -2000000000 }],
      ['intMax', { type: TagType.Int, value: 2147483647 }],
      ['longTag', { type: TagType.Long, value: 9223372036854775807n }],
      ['longMin', { type: TagType.Long, value: -9223372036854775808n }],
      ['floatTag', { type: TagType.Float, value: Math.fround(3.14) }],
      ['doubleTag', { type: TagType.Double, value: 2.718281828459045 }],
      ['byteArrayTag', { type: TagType.ByteArray, value: Int8Array.from([-1, 0, 1, 127, -128]) }],
      ['stringTag', { type: TagType.String, value: 'Hello, NBT! éå你好' }],
      ['emptyString', { type: TagType.String, value: '' }],
      ['intArrayTag', { type: TagType.IntArray, value: Int32Array.from([0, -1, 2147483647, -2147483648]) }],
      [
        'longArrayTag',
        {
          type: TagType.LongArray,
          value: BigInt64Array.from([0n, -1n, 9223372036854775807n, -9223372036854775808n]),
        },
      ],
      [
        'listOfInts',
        {
          type: TagType.List,
          elementType: TagType.Int,
          value: [
            { type: TagType.Int, value: 1 },
            { type: TagType.Int, value: 2 },
            { type: TagType.Int, value: 3 },
          ],
        },
      ],
      ['emptyList', { type: TagType.List, elementType: TagType.End, value: [] }],
      ['emptyCompoundList', { type: TagType.List, elementType: TagType.Compound, value: [] }],
      [
        'listOfCompounds',
        {
          type: TagType.List,
          elementType: TagType.Compound,
          value: [
            {
              type: TagType.Compound,
              value: new Map<string, Tag>([
                ['id', { type: TagType.String, value: 'minecraft:stone' }],
                ['count', { type: TagType.Byte, value: 64 }],
              ]),
            },
            {
              type: TagType.Compound,
              value: new Map<string, Tag>([
                ['id', { type: TagType.String, value: 'minecraft:dirt' }],
                ['count', { type: TagType.Byte, value: 1 }],
              ]),
            },
          ],
        },
      ],
      [
        'nested',
        {
          type: TagType.Compound,
          value: new Map<string, Tag>([
            ['level', { type: TagType.Int, value: 42 }],
            [
              'deeper',
              {
                type: TagType.Compound,
                value: new Map<string, Tag>([['flag', { type: TagType.Byte, value: 1 }]]),
              },
            ],
          ]),
        },
      ],
    ]),
  }
  return { name: 'Level', root, compression }
}

// The hackathon briefing shipped a real gzip-compressed level.dat as base64,
// but the payload was truncated in transit and will not decompress. Rather
// than fabricate a Minecraft file, we synthesize an equivalent gzip-compressed
// NBT fixture here (covering every tag type) and persist it to
// src/nbt/fixtures/level.dat so it is checked into the repo exactly like a
// real sample would be.
beforeAll(async () => {
  if (!existsSync(FIXTURE_DIR)) mkdirSync(FIXTURE_DIR, { recursive: true })
  if (!existsSync(LEVEL_DAT)) {
    const bytes = await serializeBinary(sampleDocument('gzip'))
    writeFileSync(LEVEL_DAT, bytes)
  }
})

describe('binary NBT round-trip', () => {
  it('every tag type survives parse -> serialize -> parse', async () => {
    const original = sampleDocument('none')
    const serialized = await serializeBinary(original)
    const parsed = await parseBinary(serialized)

    // First parse should faithfully reconstruct the source document.
    expect(parsed).toEqual(original)

    // Serialize again and re-parse; the two parses must deep-equal.
    const reserialized = await serializeBinary(parsed)
    const reparsed = await parseBinary(reserialized)
    expect(reparsed).toEqual(parsed)

    // An uncompressed document must serialize to identical bytes both times.
    expect(reserialized).toEqual(serialized)
  })

  it('gzipped level.dat round-trips byte-for-byte after decompression', async () => {
    const bytes = new Uint8Array(readFileSync(LEVEL_DAT))

    // Fixture is gzip-compressed: magic bytes 1f 8b.
    expect(bytes[0]).toBe(0x1f)
    expect(bytes[1]).toBe(0x8b)

    const doc = await parseBinary(bytes)
    expect(doc.compression).toBe('gzip')

    // Parse -> serialize -> parse -> deep-equal.
    const serialized = await serializeBinary(doc)
    const reparsed = await parseBinary(serialized)
    expect(reparsed).toEqual(doc)

    // The decompressed payloads must be byte-identical across a round-trip.
    const first = await parseBinary(await serializeBinary({ ...doc, compression: 'none' }))
    const second = await serializeBinary({ ...first, compression: 'none' })
    const firstPayload = await serializeBinary({ ...doc, compression: 'none' })
    expect(second).toEqual(firstPayload)
  })
})

/** A Compound covering every tag type and every numeric suffix. */
function sampleSnbtDocument(): Tag {
  const inner = new Map<string, Tag>([
    ['byte', { type: TagType.Byte, value: -7 }],
    ['short', { type: TagType.Short, value: 1234 }],
    ['int', { type: TagType.Int, value: -42 }],
    ['long', { type: TagType.Long, value: 9007199254740993n }],
    ['float', { type: TagType.Float, value: Math.fround(3.14) }],
    ['double', { type: TagType.Double, value: 2.718281828 }],
    ['doubleWhole', { type: TagType.Double, value: 5 }],
    ['quoted', { type: TagType.String, value: 'hello "world"\\ and spaces' }],
    ['unquoted', { type: TagType.String, value: 'plain_token-1.0' }],
    ['byteArray', { type: TagType.ByteArray, value: new Int8Array([1, -2, 3]) }],
    ['intArray', { type: TagType.IntArray, value: new Int32Array([10, -20, 30]) }],
    ['longArray', { type: TagType.LongArray, value: new BigInt64Array([1n, -2n, 300n]) }],
  ])

  const list: Tag = {
    type: TagType.List,
    elementType: TagType.Int,
    value: [
      { type: TagType.Int, value: 1 },
      { type: TagType.Int, value: 2 },
      { type: TagType.Int, value: 3 },
    ],
  }

  return {
    type: TagType.Compound,
    value: new Map<string, Tag>([
      ['scalars', { type: TagType.Compound, value: inner }],
      ['list', list],
      ['nested', { type: TagType.Compound, value: new Map([['empty', { type: TagType.List, elementType: TagType.End, value: [] }]]) }],
    ]),
  }
}

describe('SNBT round-trip', () => {
  it('every tag type survives parse -> serialize -> parse', () => {
    const original = sampleSnbtDocument()
    const once = serializeSnbt(original)
    const parsed = parseSnbt(once)
    const twice = serializeSnbt(parsed)

    // Deterministic serialization: text and re-parsed tag are stable.
    expect(twice).toBe(once)
    expect(parsed).toEqual(original)
  })

  it('type suffixes (b, s, L, f, d) and typed arrays ([B;], [I;], [L;])', () => {
    expect(parseSnbt('1b')).toEqual({ type: TagType.Byte, value: 1 })
    expect(parseSnbt('1s')).toEqual({ type: TagType.Short, value: 1 })
    expect(parseSnbt('1')).toEqual({ type: TagType.Int, value: 1 })
    expect(parseSnbt('1L')).toEqual({ type: TagType.Long, value: 1n })
    expect(parseSnbt('1.5f')).toEqual({ type: TagType.Float, value: Math.fround(1.5) })
    expect(parseSnbt('1.5')).toEqual({ type: TagType.Double, value: 1.5 })
    expect(parseSnbt('1.5d')).toEqual({ type: TagType.Double, value: 1.5 })

    // Lower/upper case suffixes are both accepted.
    expect(parseSnbt('10B')).toEqual({ type: TagType.Byte, value: 10 })
    expect(parseSnbt('10l')).toEqual({ type: TagType.Long, value: 10n })
    expect(parseSnbt('2.0D')).toEqual({ type: TagType.Double, value: 2 })

    // Unquoted non-numeric tokens are strings, not numbers.
    expect(parseSnbt('foo')).toEqual({ type: TagType.String, value: 'foo' })
    expect(parseSnbt('true')).toEqual({ type: TagType.String, value: 'true' })

    // Typed arrays map to the correct container type.
    expect(parseSnbt('[B;1b,2b]')).toEqual({
      type: TagType.ByteArray,
      value: new Int8Array([1, 2]),
    })
    expect(parseSnbt('[I;1,2]')).toEqual({
      type: TagType.IntArray,
      value: new Int32Array([1, 2]),
    })
    expect(parseSnbt('[L;1L,2L]')).toEqual({
      type: TagType.LongArray,
      value: new BigInt64Array([1n, 2n]),
    })
  })
})
