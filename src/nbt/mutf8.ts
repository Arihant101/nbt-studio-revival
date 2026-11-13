// Java "Modified UTF-8" (the encoding DataOutput.writeUTF uses, and therefore
// the encoding every NBT string is stored in).
//
// It differs from standard UTF-8 in two ways that matter for round-trips:
//   - U+0000 is written as the two bytes C0 80 (never a raw 00 byte).
//   - Characters outside the BMP (emoji etc.) are written as their two UTF-16
//     surrogates, each as its own 3-byte sequence (CESU-8), never as a 4-byte
//     UTF-8 sequence. Java's readUTF rejects 4-byte sequences, so writing plain
//     UTF-8 would produce files Minecraft cannot load.
//
// The decoder is lenient: it also accepts standard 4-byte UTF-8 (written by
// some third-party tools) and maps malformed bytes to U+FFFD instead of
// throwing, so a slightly broken string never makes a whole file unreadable.

/** Max bytes an NBT string may occupy: its length prefix is an unsigned short. */
export const MAX_STRING_BYTES = 0xffff

/** Encode `value` as Modified UTF-8. Throws if it would exceed 65535 bytes. */
export function encodeMutf8(value: string): Uint8Array {
  // Fast path: pure ASCII without NUL is identical in every encoding.
  let ascii = true
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i)
    if (c === 0 || c > 0x7f) {
      ascii = false
      break
    }
  }
  if (ascii) {
    if (value.length > MAX_STRING_BYTES) throw tooLong(value.length)
    const out = new Uint8Array(value.length)
    for (let i = 0; i < value.length; i++) out[i] = value.charCodeAt(i)
    return out
  }

  let size = 0
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i)
    size += c >= 0x01 && c <= 0x7f ? 1 : c <= 0x7ff ? 2 : 3
  }
  if (size > MAX_STRING_BYTES) throw tooLong(size)

  const out = new Uint8Array(size)
  let o = 0
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i)
    if (c >= 0x01 && c <= 0x7f) {
      out[o++] = c
    } else if (c <= 0x7ff) {
      out[o++] = 0xc0 | (c >> 6)
      out[o++] = 0x80 | (c & 0x3f)
    } else {
      out[o++] = 0xe0 | (c >> 12)
      out[o++] = 0x80 | ((c >> 6) & 0x3f)
      out[o++] = 0x80 | (c & 0x3f)
    }
  }
  return out
}

function tooLong(bytes: number): Error {
  return new Error(
    `String is too long for NBT: ${bytes} bytes encoded (max ${MAX_STRING_BYTES})`,
  )
}

const REPLACEMENT = 0xfffd

/** Decode Modified UTF-8 (leniently also accepting 4-byte UTF-8). */
export function decodeMutf8(bytes: Uint8Array): string {
  const units: number[] = []
  let i = 0
  const n = bytes.length
  while (i < n) {
    const b = bytes[i]!
    if (b < 0x80) {
      units.push(b)
      i += 1
    } else if ((b & 0xe0) === 0xc0 && i + 1 < n && (bytes[i + 1]! & 0xc0) === 0x80) {
      units.push(((b & 0x1f) << 6) | (bytes[i + 1]! & 0x3f))
      i += 2
    } else if (
      (b & 0xf0) === 0xe0 &&
      i + 2 < n &&
      (bytes[i + 1]! & 0xc0) === 0x80 &&
      (bytes[i + 2]! & 0xc0) === 0x80
    ) {
      units.push(((b & 0x0f) << 12) | ((bytes[i + 1]! & 0x3f) << 6) | (bytes[i + 2]! & 0x3f))
      i += 3
    } else if (
      (b & 0xf8) === 0xf0 &&
      i + 3 < n &&
      (bytes[i + 1]! & 0xc0) === 0x80 &&
      (bytes[i + 2]! & 0xc0) === 0x80 &&
      (bytes[i + 3]! & 0xc0) === 0x80
    ) {
      // Standard UTF-8 4-byte sequence (not produced by Java, tolerated here).
      const cp =
        ((b & 0x07) << 18) |
        ((bytes[i + 1]! & 0x3f) << 12) |
        ((bytes[i + 2]! & 0x3f) << 6) |
        (bytes[i + 3]! & 0x3f)
      if (cp >= 0x10000 && cp <= 0x10ffff) {
        const v = cp - 0x10000
        units.push(0xd800 | (v >> 10), 0xdc00 | (v & 0x3ff))
      } else {
        units.push(REPLACEMENT)
      }
      i += 4
    } else {
      units.push(REPLACEMENT)
      i += 1
    }
  }
  // Build the string in chunks so very long strings never blow the argument
  // limit of String.fromCharCode.apply.
  let out = ''
  for (let k = 0; k < units.length; k += 0x2000) {
    out += String.fromCharCode(...units.slice(k, k + 0x2000))
  }
  return out
}
