import { describe, it } from 'vitest'

describe('binary NBT round-trip', () => {
  it.todo('every tag type survives parse -> serialize -> parse')
  it.todo('gzipped level.dat round-trips byte-for-byte after decompression')
})

describe('SNBT round-trip', () => {
  it.todo('every tag type survives parse -> serialize -> parse')
  it.todo('type suffixes (b, s, L, f, d) and typed arrays ([B;], [I;], [L;])')
})
