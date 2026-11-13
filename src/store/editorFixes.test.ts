// Regression tests for editor bugs found in the post-Kiro audit.
import { beforeEach, describe, expect, it } from 'vitest'

import { useNbtStore } from './useNbtStore'
import { getIn } from '../nbt/edit'
import { parseDraft } from '../tree/EditableLeafValue'
import type { NbtDocument, Tag } from '../nbt/types'
import { TagType } from '../nbt/types'

const int = (value: number): Tag => ({ type: TagType.Int, value })

function makeDoc(): NbtDocument {
  return {
    name: 'Level',
    compression: 'none',
    root: {
      type: TagType.Compound,
      value: new Map<string, Tag>([
        ['list', { type: TagType.List, elementType: TagType.Int, value: [int(0), int(1), int(2), int(3)] }],
        [
          'box',
          { type: TagType.Compound, value: new Map<string, Tag>([['inner', int(5)]]) },
        ],
        ['f', { type: TagType.Float, value: 0 }],
        ['l', { type: TagType.Long, value: 0n }],
      ]),
    },
  }
}

const s = () => useNbtStore.getState()
const id = (...path: (string | number)[]) => JSON.stringify(path)

beforeEach(() => {
  s().clear()
  s().load('test.nbt', makeDoc())
})

describe('haunted markers follow their nodes through structural edits', () => {
  it('List remove shifts later markers down and drops the removed one', () => {
    s().setValue(['list', 1], 11)
    s().setValue(['list', 3], 33)
    s().remove(['list', 1])
    expect([...s().dirty]).toEqual([id('list', 2)])
    expect(getIn(s().doc!.root, ['list', 2])).toEqual(int(33))
  })

  it('List insert shifts later markers up', () => {
    s().setValue(['list', 2], 22)
    s().add(['list'], int(9), 0)
    expect(s().dirty.has(id('list', 3))).toBe(true)
    expect(getIn(s().doc!.root, ['list', 3])).toEqual(int(22))
  })

  it('rename carries descendant markers to the new key', () => {
    s().setValue(['box', 'inner'], 6)
    s().rename([], 'box', 'crate')
    expect(s().dirty.has(id('crate', 'inner'))).toBe(true)
    expect(s().dirty.has(id('box', 'inner'))).toBe(false)
  })

  it('removing a Compound entry drops its subtree markers', () => {
    s().setValue(['box', 'inner'], 6)
    s().remove(['box'])
    expect(s().dirty.size).toBe(0)
  })
})

describe('unsaved tracking', () => {
  it('a delete alone counts as unsaved; export clears it', () => {
    expect(s().unsaved).toBe(false)
    s().remove(['f'])
    expect(s().unsaved).toBe(true)
    s().markExported()
    expect(s().unsaved).toBe(false)
  })

  it('resurrect is an unsaved, haunted change', () => {
    s().remove(['f'])
    s().markExported()
    s().resurrect(s().graveyard[0]!.id)
    expect(s().unsaved).toBe(true)
    expect(s().dirty.has(id('f'))).toBe(true)
  })

  it('load bumps docVersion so views reset', () => {
    const v = s().docVersion
    s().load('other.nbt', makeDoc())
    expect(s().docVersion).toBe(v + 1)
  })
})

describe('graveyard', () => {
  it('resurrects a List element even after earlier siblings were deleted', () => {
    s().remove(['list', 3])
    s().remove(['list', 0])
    s().remove(['list', 0])
    const grave = s().graveyard[0]!
    s().resurrect(grave.id)
    expect(s().graveyardError).toBeNull()
    expect(getIn(s().doc!.root, ['list'])).toMatchObject({ value: [int(2), int(3)] })
  })
})

describe('value validation', () => {
  it('Float edits are stored at 32-bit precision', () => {
    s().setValue(['f'], 0.1)
    expect((getIn(s().doc!.root, ['f']) as { value: number }).value).toBe(Math.fround(0.1))
  })

  it('Long edits outside i64 are rejected', () => {
    expect(() => s().setValue(['l'], 2n ** 63n)).toThrow(/out of range/)
  })

  it('typed-array drafts reject out-of-range and fractional values instead of wrapping', () => {
    const byteArr: Tag = { type: TagType.ByteArray, value: new Int8Array() }
    const intArr: Tag = { type: TagType.IntArray, value: new Int32Array() }
    const longArr: Tag = { type: TagType.LongArray, value: new BigInt64Array() }
    expect(() => parseDraft(byteArr, '1, 200')).toThrow(/out of range/)
    expect(() => parseDraft(byteArr, '1.5')).toThrow(/whole number/)
    expect(() => parseDraft(intArr, '3000000000')).toThrow(/out of range/)
    expect(() => parseDraft(longArr, '99999999999999999999')).toThrow(/out of range/)
    expect(parseDraft(byteArr, '-128, 127')).toEqual(new Int8Array([-128, 127]))
    expect(parseDraft(longArr, '5L, -1')).toEqual(new BigInt64Array([5n, -1n]))
  })

  it('Long drafts accept an L suffix and give a friendly error', () => {
    const long: Tag = { type: TagType.Long, value: 0n }
    expect(parseDraft(long, '42L')).toBe(42n)
    expect(() => parseDraft(long, '1.5')).toThrow(/not a whole number/)
  })
})
