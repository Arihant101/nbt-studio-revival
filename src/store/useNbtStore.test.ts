import { beforeEach, describe, expect, it } from 'vitest'

import { useNbtStore } from './useNbtStore'
import { getIn } from '../nbt/edit'
import type { NbtDocument, Tag } from '../nbt/types'
import { TagType } from '../nbt/types'

function makeDoc(): NbtDocument {
  return {
    name: 'Level',
    compression: 'none',
    root: {
      type: TagType.Compound,
      value: new Map<string, Tag>([
        ['intTag', { type: TagType.Int, value: 1 }],
        ['stringTag', { type: TagType.String, value: 'hi' }],
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
      ]),
    },
  }
}

beforeEach(() => {
  useNbtStore.getState().clear()
})

describe('useNbtStore edit actions', () => {
  it('setValue produces a new doc reference and mutation is visible via getIn', () => {
    useNbtStore.getState().load('level.dat', makeDoc())
    const before = useNbtStore.getState().doc!
    useNbtStore.getState().setValue(['intTag'], 42)
    const after = useNbtStore.getState().doc!
    expect(after).not.toBe(before)
    expect(after.root).not.toBe(before.root)
    expect(getIn(after.root, ['intTag'])).toEqual({ type: TagType.Int, value: 42 })
  })

  it('rename changes a compound key', () => {
    useNbtStore.getState().load('level.dat', makeDoc())
    useNbtStore.getState().rename([], 'intTag', 'renamed')
    const doc = useNbtStore.getState().doc!
    expect(getIn(doc.root, ['renamed'])).toEqual({ type: TagType.Int, value: 1 })
    expect(getIn(doc.root, ['intTag'])).toBeUndefined()
  })

  it('add inserts into a compound and appends to a list', () => {
    useNbtStore.getState().load('level.dat', makeDoc())
    useNbtStore.getState().add([], { type: TagType.Byte, value: 7 }, 'b')
    useNbtStore.getState().add(['intList'], { type: TagType.Int, value: 30 })
    const doc = useNbtStore.getState().doc!
    expect(getIn(doc.root, ['b'])).toEqual({ type: TagType.Byte, value: 7 })
    expect(getIn(doc.root, ['intList', 2])).toEqual({ type: TagType.Int, value: 30 })
  })

  it('remove deletes a tag and returns a removal record', () => {
    useNbtStore.getState().load('level.dat', makeDoc())
    const before = useNbtStore.getState().doc!
    const record = useNbtStore.getState().remove(['stringTag'])
    const after = useNbtStore.getState().doc!
    expect(after).not.toBe(before)
    expect(getIn(after.root, ['stringTag'])).toBeUndefined()
    expect(record).toEqual({
      removed: { type: TagType.String, value: 'hi' },
      parentPath: [],
      key: 'stringTag',
      index: 1,
    })
  })

  it('move reorders a list element', () => {
    useNbtStore.getState().load('level.dat', makeDoc())
    useNbtStore.getState().move(['intList', 0], 1)
    const doc = useNbtStore.getState().doc!
    expect(getIn(doc.root, ['intList', 0])).toEqual({ type: TagType.Int, value: 20 })
    expect(getIn(doc.root, ['intList', 1])).toEqual({ type: TagType.Int, value: 10 })
  })

  it('actions are no-ops when doc is null', () => {
    const s = useNbtStore.getState()
    expect(() => s.setValue(['intTag'], 1)).not.toThrow()
    expect(() => s.rename([], 'a', 'b')).not.toThrow()
    expect(() => s.add([], { type: TagType.Int, value: 1 }, 'x')).not.toThrow()
    expect(() => s.move(['x', 0], 1)).not.toThrow()
    expect(s.remove(['x'])).toBeUndefined()
    expect(useNbtStore.getState().doc).toBeNull()
  })
})

describe('useNbtStore graveyard (undo)', () => {
  it('load and clear start with an empty graveyard and no error', () => {
    const s = () => useNbtStore.getState()
    s().load('level.dat', makeDoc())
    s().remove(['stringTag'])
    expect(s().graveyard).toHaveLength(1)
    // Loading a fresh doc resets the graveyard.
    s().load('other.dat', makeDoc())
    expect(s().graveyard).toHaveLength(0)
    expect(s().graveyardError).toBeNull()
    s().remove(['intTag'])
    expect(s().graveyard).toHaveLength(1)
    s().clear()
    expect(s().graveyard).toHaveLength(0)
    expect(s().graveyardError).toBeNull()
  })

  it('removing a Compound entry records its key and ordinal in the graveyard', () => {
    const s = () => useNbtStore.getState()
    s().load('level.dat', makeDoc())
    s().remove(['stringTag'])
    const graveyard = s().graveyard
    expect(graveyard).toHaveLength(1)
    expect(graveyard[0].record).toEqual({
      removed: { type: TagType.String, value: 'hi' },
      parentPath: [],
      key: 'stringTag',
      index: 1,
    })
    expect(typeof graveyard[0].id).toBe('string')
  })

  it('resurrect restores a Compound entry to its original ordinal position', () => {
    const s = () => useNbtStore.getState()
    s().load('level.dat', makeDoc())
    s().remove(['stringTag'])
    const id = s().graveyard[0].id
    s().resurrect(id)
    const doc = s().doc!
    // The tag is back...
    expect(getIn(doc.root, ['stringTag'])).toEqual({ type: TagType.String, value: 'hi' })
    // ...at its original ordinal slot (index 1, after intTag).
    const compound = doc.root
    expect(compound.type).toBe(TagType.Compound)
    if (compound.type === TagType.Compound) {
      expect([...compound.value.keys()]).toEqual(['intTag', 'stringTag', 'intList'])
    }
    // ...and the graveyard is empty again, no error.
    expect(s().graveyard).toHaveLength(0)
    expect(s().graveyardError).toBeNull()
  })

  it('resurrect restores a List element at its original index', () => {
    const s = () => useNbtStore.getState()
    s().load('level.dat', makeDoc())
    s().remove(['intList', 0])
    expect(s().graveyard).toHaveLength(1)
    expect(s().graveyard[0].record.index).toBe(0)
    const id = s().graveyard[0].id
    s().resurrect(id)
    const doc = s().doc!
    expect(getIn(doc.root, ['intList', 0])).toEqual({ type: TagType.Int, value: 10 })
    expect(getIn(doc.root, ['intList', 1])).toEqual({ type: TagType.Int, value: 20 })
    expect(s().graveyard).toHaveLength(0)
  })

  it('resurrect into a missing location sets a themed error and leaves the doc uncorrupted', () => {
    const s = () => useNbtStore.getState()
    s().load('level.dat', makeDoc())
    // Add a nested compound so we can delete a child then delete its parent.
    s().add([], { type: TagType.Compound, value: new Map<string, Tag>() }, 'holder')
    s().add(['holder'], { type: TagType.Int, value: 5 }, 'child')
    // Remove the child first (captured in the graveyard)...
    s().remove(['holder', 'child'])
    const childId = s().graveyard.find((e) => e.record.key === 'child')!.id
    // ...then remove its parent, so the child's grave no longer exists.
    s().remove(['holder'])
    const rootBefore = s().doc!.root
    // Resurrecting the child must NOT throw or corrupt the tree.
    expect(() => s().resurrect(childId)).not.toThrow()
    const rootAfter = s().doc!.root
    // Root is unchanged (no mutation applied).
    expect(rootAfter).toBe(rootBefore)
    expect(getIn(rootAfter, ['holder'])).toBeUndefined()
    // A themed error is set and the entry stays in the graveyard.
    expect(s().graveyardError).not.toBeNull()
    expect(s().graveyardError).toContain('child')
    expect(s().graveyard.some((e) => e.id === childId)).toBe(true)
    // The error can be dismissed.
    s().clearGraveyardError()
    expect(s().graveyardError).toBeNull()
  })

  it('resurrect with an unknown id is a no-op', () => {
    const s = () => useNbtStore.getState()
    s().load('level.dat', makeDoc())
    const before = s().doc!
    s().resurrect('grave-does-not-exist')
    expect(s().doc).toBe(before)
    expect(s().graveyardError).toBeNull()
  })
})

describe('useNbtStore haunted/dirty tracking', () => {
  const s = () => useNbtStore.getState()
  // Path ids use the same JSON.stringify(path) form as NbtTree's pathId.
  const id = (path: unknown[]): string => JSON.stringify(path)

  it('load starts with an empty dirty set', () => {
    s().load('level.dat', makeDoc())
    expect(s().dirty.size).toBe(0)
  })

  it('setValue marks the edited leaf path dirty', () => {
    s().load('level.dat', makeDoc())
    s().setValue(['intTag'], 42)
    expect(s().dirty.has(id(['intTag']))).toBe(true)
  })

  it('rename marks the renamed key’s new path dirty', () => {
    s().load('level.dat', makeDoc())
    s().rename([], 'intTag', 'renamed')
    expect(s().dirty.has(id(['renamed']))).toBe(true)
  })

  it('add marks the new child path dirty for a Compound key', () => {
    s().load('level.dat', makeDoc())
    s().add([], { type: TagType.Byte, value: 7 }, 'b')
    expect(s().dirty.has(id(['b']))).toBe(true)
  })

  it('add marks the appended index dirty for a List append', () => {
    s().load('level.dat', makeDoc())
    // intList starts with two elements, so an append lands at index 2.
    s().add(['intList'], { type: TagType.Int, value: 30 })
    expect(s().dirty.has(id(['intList', 2]))).toBe(true)
  })

  it('move marks the moved List element’s resulting index dirty', () => {
    s().load('level.dat', makeDoc())
    s().move(['intList', 0], 1)
    expect(s().dirty.has(id(['intList', 1]))).toBe(true)
  })

  it('remove does NOT add a dirty path (reflected by the graveyard instead)', () => {
    s().load('level.dat', makeDoc())
    s().remove(['stringTag'])
    expect(s().dirty.size).toBe(0)
  })

  it('markExported clears all dirty paths', () => {
    s().load('level.dat', makeDoc())
    s().setValue(['intTag'], 42)
    s().add([], { type: TagType.Byte, value: 7 }, 'b')
    expect(s().dirty.size).toBeGreaterThan(0)
    s().markExported()
    expect(s().dirty.size).toBe(0)
  })

  it('load and clear reset dirty to empty', () => {
    s().load('level.dat', makeDoc())
    s().setValue(['intTag'], 42)
    expect(s().dirty.size).toBe(1)
    // Loading a fresh doc clears dirty.
    s().load('other.dat', makeDoc())
    expect(s().dirty.size).toBe(0)
    s().setValue(['intTag'], 7)
    expect(s().dirty.size).toBe(1)
    s().clear()
    expect(s().dirty.size).toBe(0)
  })
})
