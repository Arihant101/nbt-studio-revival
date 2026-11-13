// Pure unit tests (node env) for parseErrorLocation — the cursed-file location
// extractor (Task 10, increment D). No DOM; drives the helper directly.

import { describe, expect, it } from 'vitest'

import { parseErrorLocation } from './parseErrorLocation'

describe('parseErrorLocation', () => {
  it('extracts the char offset from an SNBT positioned message', () => {
    expect(parseErrorLocation('Unexpected character at position 12')).toEqual({
      kind: 'position',
      position: 12,
    })
  })

  it('extracts the position from a trailing-characters message', () => {
    expect(parseErrorLocation('Unexpected trailing characters at position 5')).toEqual({
      kind: 'position',
      position: 5,
    })
  })

  it('reads the message from an Error instance', () => {
    expect(parseErrorLocation(new Error('Bad token at position 0'))).toEqual({
      kind: 'position',
      position: 0,
    })
  })

  it('returns kind:none for a structural binary error with no position', () => {
    expect(parseErrorLocation('Unexpected end of buffer while reading tag')).toEqual({
      kind: 'none',
    })
  })

  it('returns kind:none for the non-Compound SNBT root error', () => {
    expect(parseErrorLocation('SNBT root must be a Compound tag, got List')).toEqual({
      kind: 'none',
    })
  })

  it('only matches a position at the very end of the message', () => {
    // 'at position 3' not at the end → no location.
    expect(parseErrorLocation('at position 3 is where it broke')).toEqual({ kind: 'none' })
  })

  it('does not throw on empty, null, undefined, or odd input', () => {
    expect(parseErrorLocation('')).toEqual({ kind: 'none' })
    expect(parseErrorLocation(null)).toEqual({ kind: 'none' })
    expect(parseErrorLocation(undefined)).toEqual({ kind: 'none' })
    expect(parseErrorLocation(42)).toEqual({ kind: 'none' })
    expect(parseErrorLocation({ nope: true })).toEqual({ kind: 'none' })
    expect(parseErrorLocation({ message: 'weird at position 7' })).toEqual({
      kind: 'position',
      position: 7,
    })
  })
})
