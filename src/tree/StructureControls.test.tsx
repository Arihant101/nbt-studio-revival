// @vitest-environment jsdom
//
// Structure-edit (Task 7) tests for the NbtTree: add / remove / rename / move
// controls committing through the shared useNbtStore singleton. Follows the
// existing NbtTree.test.tsx pattern: load a fresh sampleDocument into the store
// in beforeEach, render <NbtTree doc={store.doc!} />, drive the controls with
// fireEvent, then re-read the store's doc and assert through edit-core getIn.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

import { NbtTree } from './NbtTree'
import { sampleDocument } from './sampleDocument'
import { TagType } from '../nbt/types'
import type { Tag } from '../nbt/types'
import { getIn } from '../nbt/edit'
import { useNbtStore } from '../store/useNbtStore'

beforeEach(() => {
  useNbtStore.getState().load('Level', sampleDocument())
})
afterEach(() => {
  useNbtStore.getState().clear()
  cleanup()
})

function renderStoreTree() {
  render(<NbtTree doc={useNbtStore.getState().doc!} />)
}

/** Expand the container node addressed by the slash-joined display path. */
function expandContainer(displayPath: string) {
  const node = document.querySelector(`[data-nbt-path="${displayPath}"]`) as HTMLElement
  // The first button inside a container row is the expand/collapse toggle.
  fireEvent.click(within(node).getAllByRole('button')[0])
}

describe('structure-edit: add', () => {
  it('adds a chosen-type tag to a Compound with a key', () => {
    renderStoreTree()
    // Root is expanded by default; its add-child control is path-qualified by
    // the empty root path, so it keeps the bare label.
    fireEvent.click(screen.getByRole('button', { name: 'Add child to Level' }))

    const typePicker = screen.getByRole('combobox', { name: 'New child type for Level' })
    // Choose Long so we can assert both the type and the 0n default value.
    fireEvent.change(typePicker, { target: { value: String(TagType.Long) } })

    const keyInput = screen.getByRole('textbox', { name: 'New child key for Level' })
    fireEvent.change(keyInput, { target: { value: 'newLong' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm add child to Level' }))

    const added = getIn(useNbtStore.getState().doc!.root, ['newLong'])
    expect(added).toEqual({ type: TagType.Long, value: 0n })
  })

  it('appends a chosen-type tag to a (homogeneous) List', () => {
    renderStoreTree()
    // intList holds 3 ints; append a 4th Int element.
    const before = getIn(useNbtStore.getState().doc!.root, ['intList']) as Tag
    expect(before.type === TagType.List ? before.value.length : -1).toBe(3)

    fireEvent.click(screen.getByRole('button', { name: 'Add child to intList (intList)' }))
    const typePicker = screen.getByRole('combobox', {
      name: 'New child type for intList (intList)',
    })
    fireEvent.change(typePicker, { target: { value: String(TagType.Int) } })
    // Lists have no key input; confirm directly.
    fireEvent.click(screen.getByRole('button', { name: 'Confirm add child to intList (intList)' }))

    const after = getIn(useNbtStore.getState().doc!.root, ['intList']) as Tag
    expect(after.type === TagType.List ? after.value.length : -1).toBe(4)
    // The appended element sits at the new last index with the default value 0.
    expect(getIn(useNbtStore.getState().doc!.root, ['intList', 3])).toEqual({
      type: TagType.Int,
      value: 0,
    })
  })

  it('rejects an empty/whitespace Compound key with a themed error and leaves the doc unchanged', () => {
    renderStoreTree()
    const before = sampleDocument().root.value.size

    fireEvent.click(screen.getByRole('button', { name: 'Add child to Level' }))
    const keyInput = screen.getByRole('textbox', { name: 'New child key for Level' })
    // A whitespace-only key must be rejected before the store is touched.
    fireEvent.change(keyInput, { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm add child to Level' }))

    const alert = screen.getByRole('alert')
    expect(alert.className).toContain('text-danger')
    expect(alert.textContent).toContain('Key cannot be empty')

    // No entry was inserted: the root size is unchanged and no ""-keyed tag landed.
    const root = useNbtStore.getState().doc!.root
    expect(root.value.size).toBe(before)
    expect(getIn(root, [''])).toBeUndefined()
  })

  it('surfaces a duplicate-key add as a themed error without corrupting the doc', () => {
    renderStoreTree()
    fireEvent.click(screen.getByRole('button', { name: 'Add child to Level' }))
    const keyInput = screen.getByRole('textbox', { name: 'New child key for Level' })
    // intTag already exists in the root compound.
    fireEvent.change(keyInput, { target: { value: 'intTag' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm add child to Level' }))

    const alert = screen.getByRole('alert')
    expect(alert.className).toContain('text-danger')
    expect(alert.textContent).toContain('already exists')

    // The existing intTag is untouched (no corruption) and no stray tag landed.
    expect(getIn(useNbtStore.getState().doc!.root, ['intTag'])).toEqual({
      type: TagType.Int,
      value: 42,
    })
    const root = useNbtStore.getState().doc!.root
    expect(root.value.size).toBe(sampleDocument().root.value.size)
  })

  it('surfaces a list type-mismatch add as a themed error without corrupting the doc', () => {
    renderStoreTree()
    fireEvent.click(screen.getByRole('button', { name: 'Add child to intList (intList)' }))
    const typePicker = screen.getByRole('combobox', {
      name: 'New child type for intList (intList)',
    })
    // intList's elementType is Int; adding a String must throw.
    fireEvent.change(typePicker, { target: { value: String(TagType.String) } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm add child to intList (intList)' }))

    const alert = screen.getByRole('alert')
    expect(alert.className).toContain('text-danger')

    // The list still has exactly its 3 original int elements.
    const list = getIn(useNbtStore.getState().doc!.root, ['intList']) as Tag
    expect(list.type === TagType.List ? list.value.length : -1).toBe(3)
  })
})

describe('structure-edit: remove', () => {
  it('removes a tag and shrinks the parent child-count', () => {
    renderStoreTree()
    const before = useNbtStore.getState().doc!.root.value.size
    fireEvent.click(screen.getByRole('button', { name: 'Delete intTag (intTag)' }))

    expect(getIn(useNbtStore.getState().doc!.root, ['intTag'])).toBeUndefined()
    expect(useNbtStore.getState().doc!.root.value.size).toBe(before - 1)
  })
})

describe('structure-edit: rename', () => {
  it('renames a Compound key, preserving order, and the old key is gone', () => {
    renderStoreTree()
    const beforeKeys = [...useNbtStore.getState().doc!.root.value.keys()]
    const intIndex = beforeKeys.indexOf('intTag')

    fireEvent.click(screen.getByRole('button', { name: 'Rename key intTag (intTag)' }))
    const input = screen.getByRole('textbox', { name: 'New key for intTag (intTag)' })
    fireEvent.change(input, { target: { value: 'renamedInt' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    const root = useNbtStore.getState().doc!.root
    expect(getIn(root, ['intTag'])).toBeUndefined()
    expect(getIn(root, ['renamedInt'])).toEqual({ type: TagType.Int, value: 42 })
    // Key order is preserved: the renamed entry keeps its original position.
    expect([...root.value.keys()][intIndex]).toBe('renamedInt')
  })

  it('surfaces a rename-to-existing-key as a themed error without corrupting the doc', () => {
    renderStoreTree()
    fireEvent.click(screen.getByRole('button', { name: 'Rename key intTag (intTag)' }))
    const input = screen.getByRole('textbox', { name: 'New key for intTag (intTag)' })
    // shortTag already exists; rename must throw and be surfaced.
    fireEvent.change(input, { target: { value: 'shortTag' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    const alert = screen.getByRole('alert')
    expect(alert.className).toContain('text-danger')
    expect(alert.textContent).toContain('already exists')

    // The input stays open with a danger border so the user can fix it.
    const stillOpen = screen.getByRole('textbox', {
      name: 'New key for intTag (intTag)',
    }) as HTMLInputElement
    expect(stillOpen.className).toContain('border-danger')

    // Neither key was corrupted: both resolve to their original values.
    const root = useNbtStore.getState().doc!.root
    expect(getIn(root, ['intTag'])).toEqual({ type: TagType.Int, value: 42 })
    expect(getIn(root, ['shortTag'])).toEqual({ type: TagType.Short, value: 1200 })
  })

  it('does not render a rename control on List elements or the root', () => {
    renderStoreTree()
    expandContainer('intList')
    // List elements are index-addressed and have no key, so no rename control.
    expect(screen.queryByRole('button', { name: 'Rename key 0 (intList/0)' })).toBeNull()
    // The root compound exposes no rename control either.
    expect(screen.queryByRole('button', { name: /^Rename key Level/ })).toBeNull()
  })
})

describe('structure-edit: move', () => {
  it('moves a List element down, changing its index', () => {
    renderStoreTree()
    expandContainer('intList')
    // intList = [100, 200, 300]. Move element 0 (value 100) down to index 1.
    fireEvent.click(screen.getByRole('button', { name: 'Move 0 (intList/0) down' }))

    expect(getIn(useNbtStore.getState().doc!.root, ['intList', 0])).toEqual({
      type: TagType.Int,
      value: 200,
    })
    expect(getIn(useNbtStore.getState().doc!.root, ['intList', 1])).toEqual({
      type: TagType.Int,
      value: 100,
    })
  })

  it('moves a List element up, changing its index', () => {
    renderStoreTree()
    expandContainer('intList')
    // Move element 2 (value 300) up to index 1.
    fireEvent.click(screen.getByRole('button', { name: 'Move 2 (intList/2) up' }))

    expect(getIn(useNbtStore.getState().doc!.root, ['intList', 1])).toEqual({
      type: TagType.Int,
      value: 300,
    })
    expect(getIn(useNbtStore.getState().doc!.root, ['intList', 2])).toEqual({
      type: TagType.Int,
      value: 200,
    })
  })

  it('disables move-up at the first element and move-down at the last', () => {
    renderStoreTree()
    expandContainer('intList')
    const up0 = screen.getByRole('button', { name: 'Move 0 (intList/0) up' }) as HTMLButtonElement
    const down2 = screen.getByRole('button', {
      name: 'Move 2 (intList/2) down',
    }) as HTMLButtonElement
    expect(up0.disabled).toBe(true)
    expect(down2.disabled).toBe(true)
  })

  it('reorders a Compound entry down via move', () => {
    renderStoreTree()
    const keysBefore = [...useNbtStore.getState().doc!.root.value.keys()]
    // byteTag is first, shortTag second. Moving byteTag down swaps them.
    expect(keysBefore[0]).toBe('byteTag')
    expect(keysBefore[1]).toBe('shortTag')

    fireEvent.click(screen.getByRole('button', { name: 'Move byteTag (byteTag) down' }))

    const keysAfter = [...useNbtStore.getState().doc!.root.value.keys()]
    expect(keysAfter[0]).toBe('shortTag')
    expect(keysAfter[1]).toBe('byteTag')
    // Values are preserved through the reorder.
    expect(getIn(useNbtStore.getState().doc!.root, ['byteTag'])).toEqual({
      type: TagType.Byte,
      value: 7,
    })
  })
})
