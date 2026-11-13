// File import for Task 8. A pure, DOM-free module that turns raw file bytes
// into an NbtDocument the existing tree view can render. It relies entirely on
// the read-only parsers (parseBinary / parseSnbt) and the authoritative tag
// model; it never mutates them. Keeping it free of React and DOM-only globals
// means it is directly unit-testable in Vitest's default node environment.
//
// parseBinary already handles gzip (1f 8b magic) detection internally and
// returns a full NbtDocument. parseSnbt returns a BARE root Tag, so the SNBT
// branch wraps it into an NbtDocument after narrowing the root to a Compound.
// Both parsers throw on malformed input; we let those messages propagate
// verbatim so the UI can surface them.

import { detectCompression, parseBinary } from '../nbt/binary'
import { MAX_FILE_BYTES } from '../nbt/limits'
import { parseSnbt } from '../nbt/snbt'
import type { NbtDocument, Tag } from '../nbt/types'
import { TagType } from '../nbt/types'

/** Map a TagType number to a readable name for the non-Compound SNBT error. */
function tagTypeName(type: TagType): string {
  for (const [name, value] of Object.entries(TagType)) {
    if (value === type) return name
  }
  return `Unknown(${type})`
}

/**
 * Derive a document name from a file name: strip any directory prefix and the
 * trailing `.snbt` extension. Returns '' when nothing sensible remains.
 */
function snbtDocName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? ''
  return base.replace(/\.snbt$/i, '')
}

/**
 * Detect the format of `bytes` and parse them into an NbtDocument.
 *
 * Detection order (first match wins):
 *   1. gzip magic — first two bytes 0x1f 0x8b => gzip-compressed binary NBT.
 *      Hand the whole buffer to parseBinary (it inflates internally).
 *   2. extension hint (case-insensitive) from `fileName`:
 *        - `.snbt` => SNBT text (decode + parseSnbt).
 *        - `.nbt` / `.dat` => raw binary NBT (parseBinary).
 *   3. ambiguous / unrecognized extension => sniff the bytes:
 *        - first non-whitespace byte is '{' (0x7b) => SNBT text.
 *        - first byte is 0x0a (tag-type 10 = Compound root) => raw binary NBT.
 *        - otherwise default to binary and let parseBinary throw a clear error.
 */
export async function importBytes(fileName: string, bytes: Uint8Array): Promise<NbtDocument> {
  const lower = fileName.toLowerCase()

  if (bytes.length === 0) {
    throw new Error('File is empty')
  }

  // (1) gzip / zlib magic → binary (parseBinary inflates it itself).
  if (detectCompression(bytes) !== 'none') {
    return parseBinary(bytes)
  }

  // (2) extension hint.
  if (lower.endsWith('.snbt') || lower.endsWith('.txt')) {
    return importSnbt(fileName, bytes)
  }
  if (BINARY_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    return parseBinary(bytes)
  }

  // (3) ambiguous → sniff the bytes. A raw uncompressed NBT file always begins
  // with the Compound root tag-type byte 0x0a (10); SNBT text begins (after any
  // leading whitespace) with '{'. 0x0a is also ASCII LF, so we check the raw
  // leading byte first before skipping whitespace to look for '{'.
  if (bytes[0] === 0x0a) {
    return parseBinary(bytes)
  }
  if (firstNonWhitespaceByte(bytes) === 0x7b /* '{' */) {
    return importSnbt(fileName, bytes)
  }
  // Any other leading byte is treated as binary too, letting parseBinary throw
  // a precise message rather than us guessing.
  return parseBinary(bytes)
}

/** Extensions that are always binary NBT (usually gzipped). */
const BINARY_EXTENSIONS = ['.nbt', '.dat', '.dat_old', '.schem', '.schematic', '.litematic']

/** Value for the file picker's accept attribute. */
export const ACCEPTED_EXTENSIONS = [...BINARY_EXTENSIONS, '.snbt', '.txt'].join(',')

/** Decode SNBT text, parse it, and wrap a Compound root into an NbtDocument. */
function importSnbt(fileName: string, bytes: Uint8Array): NbtDocument {
  const text = new TextDecoder().decode(bytes)
  const tag: Tag = parseSnbt(text)
  // Narrow to the Compound variant so the assignment to NbtDocument.root is
  // type-safe with no `any` and no unchecked cast. A non-Compound root is not a
  // valid document, so we reject it with a clear message instead of loading it.
  if (tag.type !== TagType.Compound) {
    throw new Error(`SNBT root must be a Compound tag, got ${tagTypeName(tag.type)}`)
  }
  return { name: snbtDocName(fileName), root: tag, compression: 'none' }
}

/** Return the first byte that is not ASCII whitespace, or undefined if none. */
function firstNonWhitespaceByte(bytes: Uint8Array): number | undefined {
  for (const byte of bytes) {
    // space, tab, LF, CR, form feed, vertical tab
    if (byte !== 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d && byte !== 0x0c && byte !== 0x0b) {
      return byte
    }
  }
  return undefined
}

/**
 * Read a picked/dropped File's bytes and import it. Parse errors propagate so
 * the caller (App) can catch and surface them without loading a broken doc.
 */
export async function importFile(file: File): Promise<NbtDocument> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(
      `File is ${(file.size / 1024 / 1024).toFixed(1)} MiB; the limit is ${MAX_FILE_BYTES / 1024 / 1024} MiB`,
    )
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  return importBytes(file.name, bytes)
}
