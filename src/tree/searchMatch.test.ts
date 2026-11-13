import { describe, expect, it } from 'vitest'

import { computeMatches } from './searchMatch'
import { sampleDocument } from './sampleDocument'
import type { NbtPath } from '../nbt/edit'

// Path ids are JSON.stringify(path) to match NbtTree's expansion Set and
// data-nbt-path-json. Build them the same way so expectations stay readable.
function id(path: NbtPath): string {
  return JSON.stringify(path)
}

describe('computeMatches', () => {
  it('matches a Compound key and records its ancestors', () => {
    const { matches, ancestors } = computeMatches(sampleDocument().root, 'stringTag')
    // stringTag is a direct child of the root compound.
    expect(matches.has(id(['stringTag']))).toBe(true)
    // Its only ancestor is the root ([]), which must be force-expandable.
    expect(ancestors.has(id([]))).toBe(true)
    // A sibling that doesn't match is not a match.
    expect(matches.has(id(['intTag']))).toBe(false)
  })

  it('matches by VALUE, not only by key (leaf value substring)', () => {
    // 'hello' only appears in stringTag's value ('hello world'), never in a
    // key. This test fails if value matching were dropped.
    const { matches, ancestors } = computeMatches(sampleDocument().root, 'hello')
    expect(matches.has(id(['stringTag']))).toBe(true)
    expect(ancestors.has(id([]))).toBe(true)
    // The matching node's key does not contain 'hello', proving value match.
    expect('stringtag'.includes('hello')).toBe(false)
  })

  it('matches a deeply-nested List-of-Compound value and expands its ancestors', () => {
    // 'minecraft:stone' is the value of compoundList[0].id.
    const { matches, ancestors } = computeMatches(sampleDocument().root, 'minecraft:stone')
    expect(matches.has(id(['compoundList', 0, 'id']))).toBe(true)
    // Every ancestor on the path must be recorded for force-expansion.
    expect(ancestors.has(id([]))).toBe(true)
    expect(ancestors.has(id(['compoundList']))).toBe(true)
    expect(ancestors.has(id(['compoundList', 0]))).toBe(true)
    // The non-matching sibling compound ([1]) is not an ancestor of a match.
    expect(ancestors.has(id(['compoundList', 1]))).toBe(false)
    // The matching leaf itself is a match, not (necessarily) an ancestor.
    expect(matches.has(id(['compoundList', 1, 'id']))).toBe(false)
  })

  it('is case-insensitive over both keys and values', () => {
    const byKey = computeMatches(sampleDocument().root, 'STRINGTAG')
    expect(byKey.matches.has(id(['stringTag']))).toBe(true)
    const byValue = computeMatches(sampleDocument().root, 'MINECRAFT:STONE')
    expect(byValue.matches.has(id(['compoundList', 0, 'id']))).toBe(true)
  })

  it('returns empty sets for an empty or whitespace-only query', () => {
    for (const q of ['', '   ']) {
      const { matches, ancestors } = computeMatches(sampleDocument().root, q)
      expect(matches.size).toBe(0)
      expect(ancestors.size).toBe(0)
    }
  })

  it('returns empty sets for a query that matches nothing', () => {
    const { matches, ancestors } = computeMatches(sampleDocument().root, 'no-such-tag-xyz')
    expect(matches.size).toBe(0)
    expect(ancestors.size).toBe(0)
  })
})
