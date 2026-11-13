// Node-env unit tests for the DOM-free import helper (Task 8). These exercise
// importBytes directly (no jsdom): binary bytes built via serializeBinary, the
// real gzip fixture read from disk, SNBT text, and the two rejection paths
// (non-Compound SNBT root, corrupted binary).

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { importBytes } from './importFile'
import { serializeBinary } from '../nbt/binary'
import { serializeSnbt } from '../nbt/snbt'
import { sampleDocument } from '../tree/sampleDocument'
import { TagType } from '../nbt/types'
import type { Tag } from '../nbt/types'

describe('importBytes: binary', () => {
  it('loads an NbtDocument from raw binary bytes built via serializeBinary', async () => {
    const doc = sampleDocument()
    const bytes = await serializeBinary(doc)
    const imported = await importBytes('level.nbt', bytes)

    expect(imported.root.type).toBe(TagType.Compound)
    expect(imported.name).toBe(doc.name)
    expect(imported.compression).toBe('none')
    // The round-tripped root carries the same entries.
    expect(imported.root.value.has('intTag')).toBe(true)
  })

  it('parses the gzip fixture (level.dat) to a doc with compression gzip', async () => {
    const fixturePath = fileURLToPath(new URL('../nbt/fixtures/level.dat', import.meta.url))
    const bytes = new Uint8Array(readFileSync(fixturePath))
    const imported = await importBytes('level.dat', bytes)

    expect(imported.root.type).toBe(TagType.Compound)
    expect(imported.compression).toBe('gzip')
  })
})

describe('importBytes: SNBT', () => {
  it('loads a doc with compression none and a Compound root from .snbt text', async () => {
    const bytes = new TextEncoder().encode('{a:1}')
    const imported = await importBytes('data.snbt', bytes)

    expect(imported.compression).toBe('none')
    expect(imported.root.type).toBe(TagType.Compound)
    expect(imported.name).toBe('data')
    expect(imported.root.value.has('a')).toBe(true)
  })

  it('round-trips a serialized Compound via serializeSnbt', async () => {
    const compound: Tag = sampleDocument().root
    const text = serializeSnbt(compound)
    const bytes = new TextEncoder().encode(text)
    const imported = await importBytes('round.snbt', bytes)

    expect(imported.root.type).toBe(TagType.Compound)
    expect(imported.root.value.has('intTag')).toBe(true)
  })

  it('rejects a non-Compound SNBT root with an error mentioning Compound', async () => {
    const bytes = new TextEncoder().encode('[1,2,3]')
    await expect(importBytes('bad.snbt', bytes)).rejects.toThrow(/Compound/)
  })
})

describe('importBytes: corrupted input', () => {
  it('rejects corrupted binary bytes', async () => {
    const bytes = new Uint8Array([0xff, 0x00, 0x01])
    await expect(importBytes('bad.nbt', bytes)).rejects.toThrow()
  })
})

describe('importBytes: hardening', () => {
  it('rejects an empty file with a clear message', async () => {
    await expect(importBytes('empty.nbt', new Uint8Array())).rejects.toThrow(/empty/)
  })

  it('sniffs zlib-compressed NBT regardless of extension', async () => {
    const bytes = await serializeBinary({ ...sampleDocument(), compression: 'zlib' })
    const doc = await importBytes('chunk.bin', bytes)
    expect(doc.compression).toBe('zlib')
  })

  it('treats .schem / .litematic as binary NBT', async () => {
    const bytes = await serializeBinary({ ...sampleDocument(), compression: 'gzip' })
    await expect(importBytes('house.schem', bytes)).resolves.toMatchObject({ compression: 'gzip' })
    await expect(importBytes('house.litematic', bytes)).resolves.toMatchObject({ compression: 'gzip' })
  })
})
