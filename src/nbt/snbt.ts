import { TagType, type Tag } from './types'

// SNBT (stringified NBT) parser + pretty printer.
//
// Format (Java Edition SNBT):
//   Compound   {key:value,...}
//   List       [a,b,...]
//   ByteArray  [B;1b,2b,...]
//   IntArray   [I;1,2,...]
//   LongArray  [L;1L,2L,...]
//   Numbers    suffix b=byte, s=short, (none)=int, L=long, f=float, d=double.
//              A bare decimal (contains '.', 'e' or explicit d suffix) is a Double.
//   Strings    quoted with " or ' (Java escapes \\, \" and \' only), or
//              unquoted when the token matches [A-Za-z0-9._+-]+ and is not a
//              valid number.
//   Keys       same quoting rules as strings.
//   Special    NaN / Infinity / -Infinity survive as Double (bare) or Float
//   floats     (with the f suffix), matching what serializeSnbt emits.
//
// Suffix letters are accepted in either case (L/l, B/b, S/s, F/f, D/d).

// ---------------------------------------------------------------------------
// Serializer (pretty printer)
// ---------------------------------------------------------------------------

const UNQUOTED_RE = /^[A-Za-z0-9._+-]+$/

/**
 * Quote a string/key only when it cannot be written unquoted. A token that
 * would reparse as a number (e.g. "123", "5b", "NaN") must be quoted too,
 * otherwise the round-trip would silently reclassify it as a numeric tag.
 */
function writeString(value: string): string {
  if (UNQUOTED_RE.test(value) && !looksNumeric(value)) return value
  // Java escapes: only backslash and the double quote are escaped inside "...".
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `"${escaped}"`
}

/**
 * True when an unquoted token would be read back as a numeric tag (or looks
 * like an out-of-range number, which parseNumericToken throws on). Either way
 * the value must be quoted to survive as a String.
 */
function looksNumeric(value: string): boolean {
  try {
    return parseNumericToken(value) !== null
  } catch {
    return true
  }
}

/** Render a 32-bit float / 64-bit double so it parses back to the same value. */
function numberToText(value: number): string {
  if (Number.isNaN(value)) return 'NaN'
  if (value === Infinity) return 'Infinity'
  if (value === -Infinity) return '-Infinity'
  return String(value)
}

export function serializeSnbt(tag: Tag): string {
  switch (tag.type) {
    case TagType.Byte:
      return `${tag.value | 0}b`
    case TagType.Short:
      return `${tag.value | 0}s`
    case TagType.Int:
      return `${tag.value | 0}`
    case TagType.Long:
      return `${tag.value.toString()}L`
    case TagType.Float:
      return `${numberToText(tag.value)}f`
    case TagType.Double: {
      const text = numberToText(tag.value)
      // Ensure doubles always carry a decimal point or suffix so they never
      // read back as an Int (e.g. 3 -> "3d", 3.5 -> "3.5").
      return /[.eEnN]/.test(text) ? text : `${text}d`
    }
    case TagType.String:
      return writeString(tag.value)
    case TagType.ByteArray:
      return `[B;${Array.from(tag.value, (n) => `${n | 0}b`).join(',')}]`
    case TagType.IntArray:
      return `[I;${Array.from(tag.value, (n) => `${n | 0}`).join(',')}]`
    case TagType.LongArray:
      return `[L;${Array.from(tag.value, (n) => `${n.toString()}L`).join(',')}]`
    case TagType.List:
      return `[${tag.value.map(serializeSnbt).join(',')}]`
    case TagType.Compound: {
      const parts: string[] = []
      for (const [key, child] of tag.value) {
        parts.push(`${writeString(key)}:${serializeSnbt(child)}`)
      }
      return `{${parts.join(',')}}`
    }
  }
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

class SnbtParser {
  private readonly text: string
  private pos = 0

  constructor(text: string) {
    this.text = text
  }

  parse(): Tag {
    this.skipWhitespace()
    const tag = this.parseValue()
    this.skipWhitespace()
    if (this.pos !== this.text.length) {
      throw new Error(`Unexpected trailing characters at position ${this.pos}`)
    }
    return tag
  }

  private error(message: string): never {
    throw new Error(`${message} at position ${this.pos}`)
  }

  private peek(): string {
    return this.text[this.pos] ?? ''
  }

  private skipWhitespace(): void {
    while (this.pos < this.text.length && /\s/.test(this.text[this.pos]!)) {
      this.pos++
    }
  }

  private expect(ch: string): void {
    if (this.peek() !== ch) this.error(`Expected '${ch}'`)
    this.pos++
  }

  private parseValue(): Tag {
    this.skipWhitespace()
    const ch = this.peek()
    if (ch === '{') return this.parseCompound()
    if (ch === '[') return this.parseListOrArray()
    if (ch === '"' || ch === "'") {
      return { type: TagType.String, value: this.parseQuotedString() }
    }
    return this.parseUnquoted()
  }

  private parseCompound(): Tag {
    this.expect('{')
    const value = new Map<string, Tag>()
    this.skipWhitespace()
    if (this.peek() === '}') {
      this.pos++
      return { type: TagType.Compound, value }
    }
    for (;;) {
      this.skipWhitespace()
      const key = this.parseKey()
      this.skipWhitespace()
      this.expect(':')
      const child = this.parseValue()
      value.set(key, child)
      this.skipWhitespace()
      const next = this.peek()
      if (next === ',') {
        this.pos++
        continue
      }
      if (next === '}') {
        this.pos++
        break
      }
      this.error("Expected ',' or '}'")
    }
    return { type: TagType.Compound, value }
  }

  private parseKey(): string {
    const ch = this.peek()
    if (ch === '"' || ch === "'") return this.parseQuotedString()
    const start = this.pos
    while (this.pos < this.text.length && UNQUOTED_RE.test(this.text[this.pos]!)) {
      this.pos++
    }
    if (this.pos === start) this.error('Expected a key')
    return this.text.slice(start, this.pos)
  }

  private parseListOrArray(): Tag {
    this.expect('[')
    // Typed array: '[B;', '[I;', '[L;'.
    if (
      /[BILbil]/.test(this.peek()) &&
      this.text[this.pos + 1] === ';'
    ) {
      const marker = this.peek().toUpperCase()
      this.pos += 2 // skip marker + ';'
      return this.parseTypedArray(marker)
    }
    return this.parseList()
  }

  private parseTypedArray(marker: string): Tag {
    const elements: Tag[] = []
    this.skipWhitespace()
    if (this.peek() !== ']') {
      for (;;) {
        elements.push(this.parseValue())
        this.skipWhitespace()
        const next = this.peek()
        if (next === ',') {
          this.pos++
          continue
        }
        if (next === ']') break
        this.error("Expected ',' or ']'")
      }
    }
    this.expect(']')

    if (marker === 'B') {
      const out = new Int8Array(elements.length)
      elements.forEach((el, i) => {
        if (el.type !== TagType.Byte && el.type !== TagType.Int) {
          this.error('Byte array elements must be byte values')
        }
        const n = Number(el.value)
        // Reject values that would silently wrap through the Int8Array (e.g.
        // [B;200] must not quietly become -56).
        if (n < -128 || n > 127) {
          this.error(`Byte array element ${n} is out of range [-128, 127]`)
        }
        out[i] = n
      })
      return { type: TagType.ByteArray, value: out }
    }
    if (marker === 'I') {
      const out = new Int32Array(elements.length)
      elements.forEach((el, i) => {
        if (el.type !== TagType.Int) {
          this.error('Int array elements must be int values')
        }
        // Int elements already pass through toInt32 when parsed, but guard any
        // future widening so oversized values cannot silently wrap here.
        if (el.value < -2147483648 || el.value > 2147483647) {
          this.error(`Int array element ${el.value} is out of range for i32`)
        }
        out[i] = el.value
      })
      return { type: TagType.IntArray, value: out }
    }
    // marker === 'L'
    const out = new BigInt64Array(elements.length)
    elements.forEach((el, i) => {
      if (el.type !== TagType.Long) {
        this.error('Long array elements must be long values')
      }
      out[i] = el.value
    })
    return { type: TagType.LongArray, value: out }
  }

  private parseList(): Tag {
    const items: Tag[] = []
    this.skipWhitespace()
    if (this.peek() === ']') {
      this.pos++
      return { type: TagType.List, elementType: TagType.End, value: items }
    }
    for (;;) {
      items.push(this.parseValue())
      this.skipWhitespace()
      const next = this.peek()
      if (next === ',') {
        this.pos++
        continue
      }
      if (next === ']') {
        this.pos++
        break
      }
      this.error("Expected ',' or ']'")
    }
    const elementType = items[0]!.type
    return { type: TagType.List, elementType, value: items }
  }

  private parseQuotedString(): string {
    const quote = this.peek()
    this.pos++ // opening quote
    let out = ''
    while (this.pos < this.text.length) {
      const ch = this.text[this.pos]!
      if (ch === '\\') {
        const escaped = this.text[this.pos + 1]
        if (escaped === undefined) this.error('Unterminated escape sequence')
        // Java Edition SNBT only treats \\, \" and \' as escapes inside a
        // quoted string. Any other backslash sequence is invalid.
        if (escaped !== '\\' && escaped !== '"' && escaped !== "'") {
          this.error(`Invalid escape sequence '\\${escaped}'`)
        }
        out += escaped
        this.pos += 2
        continue
      }
      if (ch === quote) {
        this.pos++
        return out
      }
      out += ch
      this.pos++
    }
    this.error('Unterminated string')
  }

  private parseUnquoted(): Tag {
    const start = this.pos
    while (this.pos < this.text.length && UNQUOTED_RE.test(this.text[this.pos]!)) {
      this.pos++
    }
    if (this.pos === start) this.error('Unexpected character')
    const token = this.text.slice(start, this.pos)
    const numeric = parseNumericToken(token)
    if (numeric) return numeric
    return { type: TagType.String, value: token }
  }
}

// Integer with optional byte/short/long suffix.
const BYTE_RE = /^[+-]?\d+[bB]$/
const SHORT_RE = /^[+-]?\d+[sS]$/
const LONG_RE = /^[+-]?\d+[lL]$/
const INT_RE = /^[+-]?\d+$/
// Floating point: requires a decimal point, exponent, or explicit f/d suffix.
const FLOAT_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?[fF]$/
const DOUBLE_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?[dD]?$/
// Special IEEE-754 values. These mirror what numberToText/serializeSnbt emits:
// a Float carries the f suffix, a Double is bare. Infinity may be signed.
const SPECIAL_FLOAT_RE = /^(NaN|[+-]?Infinity)[fF]$/
const SPECIAL_DOUBLE_RE = /^(NaN|[+-]?Infinity)$/

// Signed 64-bit range for Long literals.
const I64_MIN = -(2n ** 63n)
const I64_MAX = 2n ** 63n - 1n

/** Map "NaN" / "Infinity" / "-Infinity" to the IEEE-754 value it names. */
function specialValue(token: string): number {
  if (token === 'NaN') return NaN
  return token[0] === '-' ? -Infinity : Infinity
}

/**
 * Map an unquoted token to a numeric Tag, or return null when it is not a
 * number (so the caller treats it as an unquoted String). A plain integer with
 * no suffix is an Int; a value with a decimal point / exponent and no suffix is
 * a Double. NaN/Infinity (optionally with the f suffix) round-trip as the
 * correct Float/Double so they are never silently reclassified as Strings.
 */
function parseNumericToken(token: string): Tag | null {
  if (SPECIAL_FLOAT_RE.test(token)) {
    return { type: TagType.Float, value: Math.fround(specialValue(token.slice(0, -1))) }
  }
  if (SPECIAL_DOUBLE_RE.test(token)) {
    return { type: TagType.Double, value: specialValue(token) }
  }
  if (BYTE_RE.test(token)) {
    return { type: TagType.Byte, value: toInt8(parseInt(token.slice(0, -1), 10)) }
  }
  if (SHORT_RE.test(token)) {
    return { type: TagType.Short, value: toInt16(parseInt(token.slice(0, -1), 10)) }
  }
  if (LONG_RE.test(token)) {
    const value = BigInt(token.slice(0, -1))
    // Reject out-of-range longs rather than let them silently wrap if later
    // pushed through a BigInt64Array, matching the i8/i16/i32 discipline.
    if (value < I64_MIN || value > I64_MAX) {
      throw new Error(`Long literal ${token} is out of range for i64`)
    }
    return { type: TagType.Long, value }
  }
  // INT_RE must be checked before DOUBLE_RE: DOUBLE_RE's suffix is optional, so
  // it also matches a bare integer. Reordering would reclassify every int as a
  // double.
  if (INT_RE.test(token)) {
    return { type: TagType.Int, value: toInt32(parseInt(token, 10)) }
  }
  if (FLOAT_RE.test(token)) {
    return { type: TagType.Float, value: Math.fround(parseFloat(token.slice(0, -1))) }
  }
  if (DOUBLE_RE.test(token)) {
    // Must contain '.', exponent, or trailing d; a bare integer was handled above.
    if (!/[.eEdD]/.test(token)) return null
    const body = /[dD]$/.test(token) ? token.slice(0, -1) : token
    return { type: TagType.Double, value: parseFloat(body) }
  }
  return null
}

function toInt8(n: number): number {
  return (n << 24) >> 24
}

function toInt16(n: number): number {
  return (n << 16) >> 16
}

function toInt32(n: number): number {
  return n | 0
}

export function parseSnbt(text: string): Tag {
  return new SnbtParser(text).parse()
}
