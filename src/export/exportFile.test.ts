// Node-env unit tests for the DOM-free export helper (Task 9). These exercise
// exportDocument and deriveExportFileName directly (no jsdom): binary bytes
// round-trip via parseBinary, compression is preserved (gzip fixture read from
// disk), SNBT text round-trips via parseSnbt, and the filename derivation rules
// (extension swap, no-extension append, null sourceFileName fallback).

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { deriveExportFileName, exportDocument } from './exportFile'
import { parseBinary, serializeBinary } from '../nbt/binary'
import { parseSnbt } from '../nbt/snbt'
import { sampleDocument } from '../tree/sampleDocument'
import { TagType } from '../nbt/types'

describe('exportDocument: binary', () => {
  it('produces bytes that parseBinary reads back into an equivalent document', async () => {
    const doc = sampleDocument()
    const result = await exportDocument(doc, 'level.dat', 'binary')

    expect(result.fileName).toBe('level.dat')
    expect(result.mimeType).toBe('application/octet-stream')
    expect(result.data).toBeInstanceOf(Uint8Array)

    const bytes = result.data as Uint8Array
    const reparsed = await parseBinary(bytes)
    expect(reparsed.root.type).toBe(TagType.Compound)
    expect(reparsed.root.value.has('intTag')).toBe(true)
    expect(reparsed.compression).toBe(doc.compression)
  })

  it('preserves gzip compression: bytes begin with the gzip magic 0x1f 0x8b', async () => {
    const fixturePath = fileURLToPath(new URL('../nbt/fixtures/level.dat', import.meta.url))
    const fixtureBytes = new Uint8Array(readFileSync(fixturePath))
    const gzipDoc = await parseBinary(fixtureBytes)
    expect(gzipDoc.compression).toBe('gzip')

    const result = await exportDocument(gzipDoc, 'level.dat', 'binary')
    const bytes = result.data as Uint8Array
    expect(bytes[0]).toBe(0x1f)
    expect(bytes[1]).toBe(0x8b)
  })

  it('preserves raw (none) compression for a sampleDocument clone', async () => {
    const doc = sampleDocument()
    const result = await exportDocument(doc, 'level.dat', 'binary')
    const bytes = result.data as Uint8Array
    // Raw uncompressed NBT begins with the Compound root tag-type byte 0x0a.
    const expected = await serializeBinary(doc)
    expect(bytes[0]).toBe(expected[0])
    expect(bytes[0]).toBe(0x0a)
  })
})

describe('exportDocument: SNBT', () => {
  it('produces text that parseSnbt reads back into a root equivalent to doc.root', async () => {
    const doc = sampleDocument()
    const result = await exportDocument(doc, 'level.dat', 'snbt')

    expect(result.fileName).toBe('level.snbt')
    expect(result.mimeType).toBe('text/plain')
    expect(typeof result.data).toBe('string')

    const root = parseSnbt(result.data as string)
    expect(root.type).toBe(TagType.Compound)
    if (root.type === TagType.Compound) {
      // Full-root equivalence: structure, scalar values, nested compounds/lists
      // and typed arrays (and the bigint Long) must all survive the round-trip,
      // not just the top-level key set. toEqual deep-compares the Map, the
      // nested Maps, List arrays and the typed arrays by value.
      expect(root).toEqual(doc.root)
    }
  })
})

describe('deriveExportFileName', () => {
  it('keeps the source binary extension and swaps to .snbt / .nbt otherwise', () => {
    expect(deriveExportFileName('level.dat', 'Level', 'binary')).toBe('level.dat')
    expect(deriveExportFileName('house.schem', 'Level', 'binary')).toBe('house.schem')
    expect(deriveExportFileName('level.dat', 'Level', 'snbt')).toBe('level.snbt')
    expect(deriveExportFileName('world.nbt', 'Level', 'snbt')).toBe('world.snbt')
    expect(deriveExportFileName('data.SNBT', 'Level', 'binary')).toBe('data.nbt')
  })

  it('appends the extension when the base has no known extension', () => {
    expect(deriveExportFileName('foo', 'Level', 'binary')).toBe('foo.nbt')
    expect(deriveExportFileName('foo', 'Level', 'snbt')).toBe('foo.snbt')
  })

  it('strips a leading directory from the source filename', () => {
    expect(deriveExportFileName('saves/world/level.dat', 'Level', 'binary')).toBe('level.dat')
  })

  it('falls back to doc.name when sourceFileName is null or empty', () => {
    expect(deriveExportFileName(null, 'Level', 'binary')).toBe('Level.nbt')
    expect(deriveExportFileName('', 'Level', 'snbt')).toBe('Level.snbt')
  })

  it('falls back to document when both sourceFileName and docName are empty', () => {
    expect(deriveExportFileName(null, '', 'binary')).toBe('document.nbt')
    expect(deriveExportFileName('', '', 'snbt')).toBe('document.snbt')
  })

  it('is consistent with exportDocument.fileName (null sourceFileName uses doc.name)', async () => {
    const doc = sampleDocument()
    const result = await exportDocument(doc, null, 'binary')
    expect(result.fileName).toBe('Level.nbt')
  })
})
