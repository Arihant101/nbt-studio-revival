import { describe, expect, it } from 'vitest'

import {
  childCount,
  formatTagValue,
  sigil,
  tagDisplay,
  tagTypeInfo,
  type SemanticColor,
} from './tagDisplay'
import type { Tag } from '../nbt/types'
import { TagType } from '../nbt/types'
import type { Theme } from '../store/useThemeStore'

const ALL_TYPES = Object.values(TagType) as TagType[]
const THEMES: Theme[] = ['dark', 'spooky']
const ALLOWED_COLORS: SemanticColor[] = ['text-accent', 'text-fg', 'text-muted', 'text-danger']

describe('tagDisplay - type presentation', () => {
  it('every TagType has a non-empty label and an allowed semantic color', () => {
    for (const type of ALL_TYPES) {
      const info = tagTypeInfo(type)
      expect(info.label.length).toBeGreaterThan(0)
      expect(ALLOWED_COLORS).toContain(info.color)
    }
  })

  it('every TagType has a non-empty sigil for both themes', () => {
    for (const type of ALL_TYPES) {
      for (const theme of THEMES) {
        expect(sigil(type, theme).length).toBeGreaterThan(0)
      }
    }
  })

  it('tagDisplay returns label + sigil + color consistent with the individual helpers', () => {
    for (const type of ALL_TYPES) {
      for (const theme of THEMES) {
        const d = tagDisplay(type, theme)
        expect(d.label).toBe(tagTypeInfo(type).label)
        expect(d.color).toBe(tagTypeInfo(type).color)
        expect(d.sigil).toBe(sigil(type, theme))
      }
    }
  })

  it('spooky Compound is a skull and spooky List is bones (steering examples)', () => {
    expect(sigil(TagType.Compound, 'spooky')).toBe('💀')
    expect(sigil(TagType.List, 'spooky')).toBe('🦴')
  })

  it('references only semantic token color utilities (no raw hex)', () => {
    for (const type of ALL_TYPES) {
      expect(tagTypeInfo(type).color).not.toMatch(/#/)
    }
  })
})

describe('formatTagValue - leaf values', () => {
  it('formats a Long bigint with full precision via String() (no Number coercion)', () => {
    const big = 9007199254740993n // Number.MAX_SAFE_INTEGER + 2, loses precision as a number
    expect(big > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true)
    const tag: Tag = { type: TagType.Long, value: big }
    expect(formatTagValue(tag)).toBe('9007199254740993')
  })

  it('formats numeric leaves readably', () => {
    expect(formatTagValue({ type: TagType.Int, value: 42 })).toBe('42')
    expect(formatTagValue({ type: TagType.Double, value: 3.5 })).toBe('3.5')
    expect(formatTagValue({ type: TagType.String, value: 'hello' })).toBe('hello')
  })

  it('shows a truncated preview with length for a large ByteArray, not the full dump', () => {
    const arr = new Int8Array(1024)
    for (let i = 0; i < arr.length; i++) arr[i] = i % 127
    const out = formatTagValue({ type: TagType.ByteArray, value: arr })
    expect(out).toContain('1024')
    expect(out).toContain('…')
    // Not a full dump: a 1024-element dump would be far longer.
    expect(out.length).toBeLessThan(60)
    // Should not contain a later element value.
    expect(out).not.toContain('100')
  })

  it('shows a truncated preview for a large IntArray', () => {
    const arr = new Int32Array([10, 20, 30, 40, 50])
    const out = formatTagValue({ type: TagType.IntArray, value: arr })
    expect(out).toBe('Int32Array(5) [10, 20, 30, …]')
  })

  it('formats LongArray elements via String() (bigint) with a preview', () => {
    const arr = new BigInt64Array([9007199254740993n, 2n])
    const out = formatTagValue({ type: TagType.LongArray, value: arr })
    expect(out).toBe('BigInt64Array(2) [9007199254740993, 2]')
  })

  it('returns empty string for container tags', () => {
    expect(formatTagValue({ type: TagType.Compound, value: new Map() })).toBe('')
    expect(formatTagValue({ type: TagType.List, elementType: TagType.Int, value: [] })).toBe('')
  })
})

describe('childCount', () => {
  it('returns Map size for a Compound', () => {
    const tag: Tag = {
      type: TagType.Compound,
      value: new Map<string, Tag>([
        ['a', { type: TagType.Int, value: 1 }],
        ['b', { type: TagType.Int, value: 2 }],
      ]),
    }
    expect(childCount(tag)).toBe(2)
  })

  it('returns array length for a List', () => {
    const tag: Tag = {
      type: TagType.List,
      elementType: TagType.Int,
      value: [
        { type: TagType.Int, value: 1 },
        { type: TagType.Int, value: 2 },
        { type: TagType.Int, value: 3 },
      ],
    }
    expect(childCount(tag)).toBe(3)
  })

  it('returns null for a leaf tag', () => {
    expect(childCount({ type: TagType.Int, value: 1 })).toBeNull()
    expect(childCount({ type: TagType.String, value: 'x' })).toBeNull()
    expect(childCount({ type: TagType.Long, value: 1n })).toBeNull()
  })
})
