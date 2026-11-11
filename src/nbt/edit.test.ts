import { describe, expect, it } from 'vitest'

import {
  addIn,
  getIn,
  moveIn,
  removeIn,
  renameIn,
  setValueIn,
} from './edit'
import type { Tag } from './types'
import { TagType } from './types'

type CompoundTag = Extract<Tag, { type: typeof TagType.Compound }>
type ListTag = Extract<Tag, { type: typeof TagType.List }>

function asCompound(tag: Tag | undefined): CompoundTag {
  if (!tag || tag.type !== TagType.Compound) throw new Error('expected compound')
  return tag
}

function asList(tag: Tag | undefined): ListTag {
  if (!tag || tag.type !== TagType.List) throw new Error('expected list')
  return tag
}

/** A fresh root compound covering nested compounds, lists, and bigints. */
function makeRoot(): CompoundTag {
  return {
    type: TagType.Compound,
    value: new Map<string, Tag>([
      ['intTag', { type: TagType.Int, value: 1 }],
      ['longTag', { type: TagType.Long, value: 9223372036854775807n }],
      ['stringTag', { type: TagType.String, value: 'hi' }],
      [
        'longArrayTag',
        { type: TagType.LongArray, value: BigInt64Array.from([1n, -2n, 9223372036854775807n]) },
      ],
      ['emptyList', { type: TagType.List, elementType: TagType.End, value: [] }],
      [
        'intList',
        {
          type: TagType.List,
          elementType: TagType.Int,
          value: [
            { type: TagType.Int, value: 10 },
            { type: TagType.Int, value: 20 },
          ],
        },
      ],
      [
        'nested',
        {
          type: TagType.Compound,
          value: new Map<string, Tag>([
            ['deep', { type: TagType.Int, value: 42 }],
          ]),
        },
      ],
    ]),
  }
}

describe('getIn', () => {
  it('resolves nested compound and list paths', () => {
    const root = makeRoot()
    expect(getIn(root, [])).toBe(root)
    expect(getIn(root, ['intTag'])).toEqual({ type: TagType.Int, value: 1 })
    expect(getIn(root, ['nested', 'deep'])).toEqual({ type: TagType.Int, value: 42 })
    expect(getIn(root, ['intList', 1])).toEqual({ type: TagType.Int, value: 20 })
  })

  it('returns undefined for missing steps', () => {
    const root = makeRoot()
    expect(getIn(root, ['nope'])).toBeUndefined()
    expect(getIn(root, ['intList', 5])).toBeUndefined()
    expect(getIn(root, ['intTag', 'x'])).toBeUndefined()
  })
})

describe('setValueIn', () => {
  it('replaces a scalar value, keeping the tag type', () => {
    const root = makeRoot()
    const next = asCompound(setValueIn(root, ['intTag'], 99))
    expect(next.value.get('intTag')).toEqual({ type: TagType.Int, value: 99 })
    // immutability: original untouched, references differ.
    expect(root.value.get('intTag')).toEqual({ type: TagType.Int, value: 1 })
    expect(next).not.toBe(root)
    expect(next.value).not.toBe(root.value)
  })

  it('preserves Long bigint values', () => {
    const root = makeRoot()
    const next = asCompound(setValueIn(root, ['longTag'], -9223372036854775808n))
    expect(next.value.get('longTag')).toEqual({ type: TagType.Long, value: -9223372036854775808n })
  })

  it('rejects a type-mismatched value', () => {
    const root = makeRoot()
    expect(() => setValueIn(root, ['intTag'], 'nope' as unknown as number)).toThrow()
    expect(() => setValueIn(root, ['longTag'], 5 as unknown as bigint)).toThrow()
  })

  it('rejects setting a value on a non-leaf tag', () => {
    const root = makeRoot()
    expect(() => setValueIn(root, ['nested'], 1)).toThrow()
    expect(() => setValueIn(root, ['intList'], 1)).toThrow()
  })
})

describe('renameIn', () => {
  it('renames a key preserving order and value', () => {
    const root = makeRoot()
    const next = asCompound(renameIn(root, [], 'intTag', 'renamed'))
    expect(next.value.has('intTag')).toBe(false)
    expect(next.value.get('renamed')).toEqual({ type: TagType.Int, value: 1 })
    expect([...next.value.keys()][0]).toBe('renamed')
    // immutability
    expect(root.value.has('intTag')).toBe(true)
    expect(next.value).not.toBe(root.value)
  })

  it('is a no-op when renaming to the same key', () => {
    const root = makeRoot()
    const next = renameIn(root, [], 'intTag', 'intTag')
    expect(asCompound(next).value.get('intTag')).toEqual({ type: TagType.Int, value: 1 })
  })

  it('rejects renaming to an existing key', () => {
    const root = makeRoot()
    expect(() => renameIn(root, [], 'intTag', 'stringTag')).toThrow()
  })

  it('rejects renaming a missing key', () => {
    const root = makeRoot()
    expect(() => renameIn(root, [], 'ghost', 'x')).toThrow()
  })
})

describe('addIn', () => {
  it('adds a keyed tag to a compound', () => {
    const root = makeRoot()
    const next = asCompound(addIn(root, [], { type: TagType.Byte, value: 7 }, 'newByte'))
    expect(next.value.get('newByte')).toEqual({ type: TagType.Byte, value: 7 })
    expect(root.value.has('newByte')).toBe(false)
  })

  it('rejects adding a duplicate compound key', () => {
    const root = makeRoot()
    expect(() => addIn(root, [], { type: TagType.Byte, value: 7 }, 'intTag')).toThrow()
  })

  it('sets elementType when adding the first element to an empty list', () => {
    const root = makeRoot()
    const next = asCompound(addIn(root, ['emptyList'], { type: TagType.String, value: 'a' }))
    const list = asList(next.value.get('emptyList'))
    expect(list.elementType).toBe(TagType.String)
    expect(list.value).toHaveLength(1)
    // original empty list untouched
    expect(asList(root.value.get('emptyList')).elementType).toBe(TagType.End)
    expect(asList(root.value.get('emptyList')).value).toHaveLength(0)
  })

  it('appends to a list when no index is given', () => {
    const root = makeRoot()
    const next = asCompound(addIn(root, ['intList'], { type: TagType.Int, value: 30 }))
    const list = asList(next.value.get('intList'))
    expect(list.value.map((t) => (t.type === TagType.Int ? t.value : null))).toEqual([10, 20, 30])
    // immutability of original array
    expect(asList(root.value.get('intList')).value).toHaveLength(2)
  })

  it('inserts at an index in a list', () => {
    const root = makeRoot()
    const next = asCompound(addIn(root, ['intList'], { type: TagType.Int, value: 15 }, 1))
    const list = asList(next.value.get('intList'))
    expect(list.value.map((t) => (t.type === TagType.Int ? t.value : null))).toEqual([10, 15, 20])
  })

  it('rejects an element whose type mismatches a non-empty list', () => {
    const root = makeRoot()
    expect(() => addIn(root, ['intList'], { type: TagType.String, value: 'x' })).toThrow()
  })

  it('rejects adding an End tag', () => {
    const root = makeRoot()
    expect(() => addIn(root, ['emptyList'], { type: TagType.End } as unknown as Tag)).toThrow()
  })

  it('rejects an out-of-range index', () => {
    const root = makeRoot()
    expect(() => addIn(root, ['intList'], { type: TagType.Int, value: 1 }, 99)).toThrow()
  })
})

describe('removeIn', () => {
  it('removes a compound key and reports a record', () => {
    const root = makeRoot()
    const { root: next, record } = removeIn(root, ['intTag'])
    expect(asCompound(next).value.has('intTag')).toBe(false)
    expect(record).toEqual({
      removed: { type: TagType.Int, value: 1 },
      parentPath: [],
      key: 'intTag',
    })
    // immutability
    expect(root.value.has('intTag')).toBe(true)
    expect(next).not.toBe(root)
  })

  it('removes a list element and reports its index', () => {
    const root = makeRoot()
    const { root: next, record } = removeIn(root, ['intList', 0])
    const list = asList(asCompound(next).value.get('intList'))
    expect(list.value.map((t) => (t.type === TagType.Int ? t.value : null))).toEqual([20])
    expect(record).toEqual({
      removed: { type: TagType.Int, value: 10 },
      parentPath: ['intList'],
      index: 0,
    })
  })

  it('resets elementType to End when the last list element is removed', () => {
    const root = makeRoot()
    const once = removeIn(root, ['intList', 0]).root
    const twice = removeIn(once, ['intList', 0]).root
    const list = asList(asCompound(twice).value.get('intList'))
    expect(list.value).toHaveLength(0)
    expect(list.elementType).toBe(TagType.End)
  })

  it('throws when removing a missing path or the root', () => {
    const root = makeRoot()
    expect(() => removeIn(root, [])).toThrow()
    expect(() => removeIn(root, ['ghost'])).toThrow()
  })
})

describe('moveIn', () => {
  it('reorders a list element to a new index', () => {
    const root = makeRoot()
    const next = asCompound(moveIn(root, ['intList', 0], 1))
    const list = asList(next.value.get('intList'))
    expect(list.value.map((t) => (t.type === TagType.Int ? t.value : null))).toEqual([20, 10])
    // immutability
    expect(asList(root.value.get('intList')).value.map((t) => (t.type === TagType.Int ? t.value : null))).toEqual([10, 20])
  })

  it('reorders a compound key by numeric position', () => {
    const root = makeRoot()
    const next = asCompound(moveIn(root, ['nested'], 0))
    expect([...next.value.keys()][0]).toBe('nested')
  })

  it('reorders a compound key relative to another key', () => {
    const root = makeRoot()
    // stringTag moves to the position currently held by intTag (index 0),
    // landing immediately before it.
    const next = asCompound(moveIn(root, ['stringTag'], 'intTag'))
    const keys = [...next.value.keys()]
    expect(keys[0]).toBe('stringTag')
    expect(keys.indexOf('stringTag')).toBeLessThan(keys.indexOf('intTag'))
  })

  it('throws on out-of-range or missing targets', () => {
    const root = makeRoot()
    expect(() => moveIn(root, ['intList', 0], 9)).toThrow()
    expect(() => moveIn(root, ['stringTag'], 'ghost')).toThrow()
    expect(() => moveIn(root, [], 0)).toThrow()
  })
})

describe('immutability of deep structures', () => {
  it('preserves typed-array instances via structural sharing on unrelated edits', () => {
    const root = makeRoot()
    const longArrayBefore = asCompound(root).value.get('longArrayTag')
    const next = asCompound(setValueIn(root, ['intTag'], 2))
    // Unrelated branch shares the same instance.
    expect(next.value.get('longArrayTag')).toBe(longArrayBefore)
  })

  it('preserves LongArray bigint contents exactly across edits', () => {
    const root = makeRoot()
    const next = asCompound(addIn(root, [], { type: TagType.Int, value: 0 }, 'x'))
    const la = next.value.get('longArrayTag')
    expect(la).toEqual({
      type: TagType.LongArray,
      value: BigInt64Array.from([1n, -2n, 9223372036854775807n]),
    })
  })
})
