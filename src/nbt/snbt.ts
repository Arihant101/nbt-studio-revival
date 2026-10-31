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
//   Strings    quoted with " or ' (backslash escapes), or unquoted when the
//              token matches [A-Za-z0-9._+-]+ and is not a valid number.
//   Keys       same quoting rules as strings.
//
// Suffix letters are accepted in either case (L/l, B/b, S/s, F/f, D/d).

// ---------------------------------------------------------------------------
// Serializer (pretty printer)
// ---------------------------------------------------------------------------

const UNQUOTED_RE = /^[A-Za-z0-9._+-]+$/

/** Quote a string/key only when it cannot be written unquoted. */
function writeString(value: string): string {
  if (UNQUOTED_RE.test(value)) return value
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `"${escaped}"`
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
        out[i] = Number(el.value)
      })
      return { type: TagType.ByteArray, value: out }
    }
    if (marker === 'I') {
      const out = new Int32Array(elements.length)
      elements.forEach((el, i) => {
        if (el.type !== TagType.Int) {
          this.error('Int array elements must be int values')
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

/**
 * Map an unquoted token to a numeric Tag, or return null when it is not a
 * number (so the caller treats it as an unquoted String). A plain integer with
 * no suffix is an Int; a value with a decimal point / exponent and no suffix is
 * a Double.
 */
function parseNumericToken(token: string): Tag | null {
  if (BYTE_RE.test(token)) {
    return { type: TagType.Byte, value: toInt8(parseInt(token.slice(0, -1), 10)) }
  }
  if (SHORT_RE.test(token)) {
    return { type: TagType.Short, value: toInt16(parseInt(token.slice(0, -1), 10)) }
  }
  if (LONG_RE.test(token)) {
    return { type: TagType.Long, value: BigInt(token.slice(0, -1)) }
  }
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
