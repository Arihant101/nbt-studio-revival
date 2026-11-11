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
  useNbtStore.setState({ fileName: null, doc: null })
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
