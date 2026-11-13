// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

import { NbtTree, parsePathId } from './NbtTree'
import { sampleDocument } from './sampleDocument'
import type { NbtDocument, Tag } from '../nbt/types'
import { TagType } from '../nbt/types'
import { getIn } from '../nbt/edit'
import { useNbtStore } from '../store/useNbtStore'

afterEach(cleanup)

describe('<NbtTree>', () => {
  it('renders the root compound', () => {
    render(<NbtTree doc={sampleDocument()} />)
    // Root node is addressable by the empty path.
    const root = document.querySelector('[data-nbt-path=""]')
    expect(root).not.toBeNull()
    // Root starts expanded, so its direct leaf children are present.
    expect(screen.getByText('intTag')).toBeTruthy()
  })

  it('shows a leaf key and its formatted value, including full-precision Long', () => {
    render(<NbtTree doc={sampleDocument()} />)
    expect(screen.getByText('intTag')).toBeTruthy()
    expect(screen.getByText('42')).toBeTruthy()
    // Long is a bigint > Number.MAX_SAFE_INTEGER; must render at full precision.
    expect(screen.getByText('longTag')).toBeTruthy()
    expect(screen.getByText('9223372036854775807')).toBeTruthy()
  })

  it('renders typed arrays as a truncated preview, not a full dump', () => {
    render(<NbtTree doc={sampleDocument()} />)
    // byteArrayTag has 8 elements; preview shows 3 then an ellipsis.
    const preview = screen.getByText('Int8Array(8) [1, 2, 3, …]')
    expect(preview).toBeTruthy()
    // Only the first 3 elements are shown, then an ellipsis; later elements
    // (4..7) must NOT appear, proving the array is not fully dumped.
    expect(preview.textContent).toContain('…')
    expect(preview.textContent).not.toContain('4, 5')
  })

  it('shows a child count on container nodes', () => {
    render(<NbtTree doc={sampleDocument()} />)
    const intList = document.querySelector('[data-nbt-path="intList"]')
    expect(intList).not.toBeNull()
    // intList has 3 int elements.
    expect(within(intList as HTMLElement).getByText('(3)')).toBeTruthy()
  })

  it('collapses children until the toggle is clicked, then reveals them', () => {
    render(<NbtTree doc={sampleDocument()} />)

    // Nested compound is collapsed by default: its inner leaf is absent.
    expect(document.querySelector('[data-nbt-path="nested/label"]')).toBeNull()
    expect(screen.queryByText('deeply nested')).toBeNull()

    // The container toggle is a real button with aria-expanded=false.
    const nested = document.querySelector('[data-nbt-path="nested"]') as HTMLElement
    const toggle = within(nested).getAllByRole('button')[0]
    expect(toggle.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(toggle)

    // After clicking, children appear and aria-expanded flips to true.
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(document.querySelector('[data-nbt-path="nested/label"]')).not.toBeNull()
    expect(screen.getByText('deeply nested')).toBeTruthy()

    // Clicking again collapses them.
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelector('[data-nbt-path="nested/label"]')).toBeNull()
  })

  it('exposes each node NbtPath via data-nbt-path, including List numeric indices', () => {
    render(<NbtTree doc={sampleDocument()} />)

    // Expand intList to reveal its numerically-indexed elements.
    const intList = document.querySelector('[data-nbt-path="intList"]') as HTMLElement
    fireEvent.click(within(intList).getAllByRole('button')[0])

    // A List element's path extends the parent with a numeric index.
    expect(document.querySelector('[data-nbt-path="intList/0"]')).not.toBeNull()
    expect(document.querySelector('[data-nbt-path="intList/2"]')).not.toBeNull()

    // Expand the first compound in compoundList, then assert a nested leaf path.
    const compoundList = document.querySelector(
      '[data-nbt-path="compoundList"]',
    ) as HTMLElement
    fireEvent.click(within(compoundList).getAllByRole('button')[0])
    const firstEntry = document.querySelector('[data-nbt-path="compoundList/0"]') as HTMLElement
    fireEvent.click(within(firstEntry).getAllByRole('button')[0])
    expect(document.querySelector('[data-nbt-path="compoundList/0/id"]')).not.toBeNull()
  })

  it('exposes the real NbtPath (string-vs-number steps preserved) via data-nbt-path-json', () => {
    const doc = sampleDocument()
    render(<NbtTree doc={doc} />)

    // Drill into compoundList -> [0] -> id, the same nested leaf as above.
    const compoundList = document.querySelector(
      '[data-nbt-path="compoundList"]',
    ) as HTMLElement
    fireEvent.click(within(compoundList).getAllByRole('button')[0])
    const firstEntry = document.querySelector('[data-nbt-path="compoundList/0"]') as HTMLElement
    fireEvent.click(within(firstEntry).getAllByRole('button')[0])

    const leaf = document.querySelector('[data-nbt-path="compoundList/0/id"]') as HTMLElement
    const realPath = parsePathId(leaf.getAttribute('data-nbt-path-json') as string)

    // The real NbtPath keeps the List index as a NUMBER and the Compound keys
    // as STRINGS - a distinction the slash-joined display form loses.
    expect(realPath).toEqual(['compoundList', 0, 'id'])
    expect(typeof realPath[1]).toBe('number')
    expect(typeof realPath[0]).toBe('string')

    // The recovered path must address the exact leaf tag through edit.ts getIn,
    // proving the data-nbt-path-json attribute is a usable Task 6/7 hook.
    const tag = getIn(doc.root, realPath)
    expect(tag).toEqual({ type: TagType.String, value: 'minecraft:stone' })
  })

  it('keeps distinct nodes addressable even when a Compound key contains the display separator', () => {
    // Two sibling keys ('a/b' and 'a') plus a nested 'b' would all collide to
    // the slash-joined string 'root/a/b'. The injective JSON id keeps them
    // distinct, so each node round-trips back to its real, correct path.
    const doc: NbtDocument = {
      name: 'collisions',
      compression: 'none',
      root: {
        type: TagType.Compound,
        value: new Map<string, Tag>([
          ['a/b', { type: TagType.Int, value: 1 }],
          [
            'a',
            {
              type: TagType.Compound,
              value: new Map<string, Tag>([['b', { type: TagType.Int, value: 2 }]]),
            },
          ],
        ]),
      },
    }
    render(<NbtTree doc={doc} />)

    // Expand 'a' so its child 'a' -> 'b' mounts.
    const aNode = document.querySelector('[data-nbt-path="a"]') as HTMLElement
    fireEvent.click(within(aNode).getAllByRole('button')[0])

    const ids = [...document.querySelectorAll('[data-nbt-path-json]')].map((el) =>
      parsePathId(el.getAttribute('data-nbt-path-json') as string),
    )

    // Both the 'a/b' key leaf and the nested a -> b leaf are present and
    // recover to DIFFERENT real paths, and each resolves to its own value.
    expect(ids).toContainEqual(['a/b'])
    expect(ids).toContainEqual(['a', 'b'])
    expect(getIn(doc.root, ['a/b'])).toEqual({ type: TagType.Int, value: 1 })
    expect(getIn(doc.root, ['a', 'b'])).toEqual({ type: TagType.Int, value: 2 })
  })
})

describe('<NbtTree> empty-container placeholder', () => {
  // A doc whose root compound holds a single EMPTY Compound child, so the
  // placeholder behaviour can be exercised by expanding that child.
  function docWithEmptyCompound(): NbtDocument {
    return {
      name: 'empties',
      compression: 'none',
      root: {
        type: TagType.Compound,
        value: new Map<string, Tag>([
          ['emptyCompound', { type: TagType.Compound, value: new Map<string, Tag>() }],
        ]),
      },
    }
  }

  it('renders a themed muted placeholder for an expanded empty container, and it is not a treeitem', () => {
    render(<NbtTree doc={docWithEmptyCompound()} />)

    // Collapsed by default: the placeholder is NOT shown yet.
    expect(screen.queryByText('(empty)')).toBeNull()

    // Expand the empty compound.
    const node = document.querySelector('[data-nbt-path="emptyCompound"]') as HTMLElement
    fireEvent.click(within(node).getAllByRole('button')[0])

    // The dark-theme placeholder appears, using the muted semantic token.
    const placeholder = screen.getByText('(empty)')
    expect(placeholder).toBeTruthy()
    expect(placeholder.className).toContain('text-muted')

    // The placeholder is presentational chrome, not a navigable treeitem: it
    // adds no new row with role=treeitem. Only root + emptyCompound remain.
    const treeitems = document.querySelectorAll('[role="treeitem"]')
    expect(treeitems.length).toBe(2)
    // The placeholder row itself carries role=presentation, never treeitem, so
    // it is not a navigable node (the treeitem count above is unchanged by it).
    const row = placeholder.closest('li') as HTMLElement
    expect(row.getAttribute('role')).toBe('presentation')
  })
})

describe('<NbtTree> inline editing', () => {
  // setValue reads the shared useNbtStore singleton, so load a fresh doc into
  // the store before each test and reset it afterwards for isolation. Tests
  // render against the store's doc and re-read it after a commit.
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

  it('activating a leaf value opens an input seeded with the current value', () => {
    renderStoreTree()
    // The resting value is an activation control with an accessible label.
    const activate = screen.getByRole('button', { name: 'Edit value of intTag (intTag)' })
    fireEvent.click(activate)

    const input = screen.getByRole('textbox', { name: 'Value for intTag (intTag)' }) as HTMLInputElement
    expect(input).toBeTruthy()
    // Seeded with the full current value.
    expect(input.value).toBe('42')
  })

  it('seeds a Long input with the full-precision bigint, not a truncated preview', () => {
    renderStoreTree()
    fireEvent.click(screen.getByRole('button', { name: 'Edit value of longTag (longTag)' }))
    const input = screen.getByRole('textbox', { name: 'Value for longTag (longTag)' }) as HTMLInputElement
    expect(input.value).toBe('9223372036854775807')
  })

  it('seeds a typed-array input with the FULL element list, not the preview', () => {
    renderStoreTree()
    fireEvent.click(screen.getByRole('button', { name: 'Edit value of intArrayTag (intArrayTag)' }))
    const input = screen.getByRole('textbox', {
      name: 'Value for intArrayTag (intArrayTag)',
    }) as HTMLInputElement
    // Full list, not the formatTagValue 3-element preview.
    expect(input.value).toBe('10, 20, 30, 40, 50')
  })

  it('committing a valid edit via Enter updates the store/doc', () => {
    renderStoreTree()
    fireEvent.click(screen.getByRole('button', { name: 'Edit value of intTag (intTag)' }))
    const input = screen.getByRole('textbox', { name: 'Value for intTag (intTag)' })
    fireEvent.change(input, { target: { value: '100' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    // The doc in the store reflects the new value.
    expect(getIn(useNbtStore.getState().doc!.root, ['intTag'])).toEqual({
      type: TagType.Int,
      value: 100,
    })
    // Edit mode closed: the input is gone, resting value shows.
    expect(screen.queryByRole('textbox', { name: 'Value for intTag (intTag)' })).toBeNull()
  })

  it('committing a valid edit via the ✓ confirm button updates the store/doc', () => {
    renderStoreTree()
    fireEvent.click(screen.getByRole('button', { name: 'Edit value of intTag (intTag)' }))
    const input = screen.getByRole('textbox', { name: 'Value for intTag (intTag)' })
    fireEvent.change(input, { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm edit of intTag (intTag)' }))

    expect(getIn(useNbtStore.getState().doc!.root, ['intTag'])).toEqual({
      type: TagType.Int,
      value: 7,
    })
  })

  it('shows a themed inline error on an invalid edit and does not corrupt the doc', () => {
    renderStoreTree()
    fireEvent.click(screen.getByRole('button', { name: 'Edit value of byteTag (byteTag)' }))
    const input = screen.getByRole('textbox', { name: 'Value for byteTag (byteTag)' })
    // 999 is out of Byte range [-128, 127]; edit-core rejects it.
    fireEvent.change(input, { target: { value: '999' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    // A themed inline error appears using the danger token.
    const alert = screen.getByRole('alert')
    expect(alert.className).toContain('text-danger')
    expect(alert.textContent).toContain('out of range')

    // The input stays open with a danger border so the user can fix it.
    const stillOpen = screen.getByRole('textbox', {
      name: 'Value for byteTag (byteTag)',
    }) as HTMLInputElement
    expect(stillOpen).toBeTruthy()
    expect(stillOpen.className).toContain('border-danger')

    // The doc's original value is untouched (no corruption).
    expect(getIn(useNbtStore.getState().doc!.root, ['byteTag'])).toEqual({
      type: TagType.Byte,
      value: 7,
    })
  })

  it('Escape cancels the edit and leaves the value unchanged', () => {
    renderStoreTree()
    fireEvent.click(screen.getByRole('button', { name: 'Edit value of intTag (intTag)' }))
    const input = screen.getByRole('textbox', { name: 'Value for intTag (intTag)' })
    fireEvent.change(input, { target: { value: '12345' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    // Edit mode closed without committing.
    expect(screen.queryByRole('textbox', { name: 'Value for intTag (intTag)' })).toBeNull()
    // The doc value is unchanged.
    expect(getIn(useNbtStore.getState().doc!.root, ['intTag'])).toEqual({
      type: TagType.Int,
      value: 42,
    })
  })

  it('does not commit on the blur that follows an Escape cancel', () => {
    renderStoreTree()
    fireEvent.click(screen.getByRole('button', { name: 'Edit value of intTag (intTag)' }))
    const input = screen.getByRole('textbox', { name: 'Value for intTag (intTag)' })
    fireEvent.change(input, { target: { value: '777' } })
    // Escape then the blur it triggers: the blur-commit must be suppressed.
    fireEvent.keyDown(input, { key: 'Escape' })
    fireEvent.blur(input)

    expect(getIn(useNbtStore.getState().doc!.root, ['intTag'])).toEqual({
      type: TagType.Int,
      value: 42,
    })
  })

  it('commits on blur', () => {
    renderStoreTree()
    fireEvent.click(screen.getByRole('button', { name: 'Edit value of intTag (intTag)' }))
    const input = screen.getByRole('textbox', { name: 'Value for intTag (intTag)' })
    fireEvent.change(input, { target: { value: '55' } })
    fireEvent.blur(input)

    expect(getIn(useNbtStore.getState().doc!.root, ['intTag'])).toEqual({
      type: TagType.Int,
      value: 55,
    })
  })

  it('round-trips a Long edit as a bigint above Number.MAX_SAFE_INTEGER', () => {
    renderStoreTree()
    fireEvent.click(screen.getByRole('button', { name: 'Edit value of longTag (longTag)' }))
    const input = screen.getByRole('textbox', { name: 'Value for longTag (longTag)' })
    fireEvent.change(input, { target: { value: '9223372036854775806' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    const committed = getIn(useNbtStore.getState().doc!.root, ['longTag'])
    expect(committed).toEqual({ type: TagType.Long, value: 9223372036854775806n })
    // Prove it is a true bigint, not a Number-lossy value.
    expect(committed && 'value' in committed ? typeof committed.value : null).toBe('bigint')
  })

  it('parses a comma-separated IntArray edit back into an Int32Array', () => {
    renderStoreTree()
    fireEvent.click(screen.getByRole('button', { name: 'Edit value of intArrayTag (intArrayTag)' }))
    const input = screen.getByRole('textbox', { name: 'Value for intArrayTag (intArrayTag)' })
    fireEvent.change(input, { target: { value: '1, 2, 3' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    const committed = getIn(useNbtStore.getState().doc!.root, ['intArrayTag'])
    expect(committed?.type).toBe(TagType.IntArray)
    expect(committed && 'value' in committed ? committed.value : null).toBeInstanceOf(Int32Array)
    expect(
      committed && 'value' in committed ? Array.from(committed.value as Int32Array) : null,
    ).toEqual([1, 2, 3])
  })

  it('does not render an editor for container (Compound/List) nodes', () => {
    renderStoreTree()
    // Containers keep the (count) display and expose no edit-value control.
    expect(screen.queryByRole('button', { name: 'Edit value of intList' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit value of nested' })).toBeNull()
  })

  it('gives two same-keyed leaves in different compounds distinct accessible names', () => {
    renderStoreTree()
    // Both compoundList entries hold a `count` Byte. Without path qualification
    // the two activation controls would share the name "Edit value of count";
    // the path-qualified name keeps them globally unique.
    const compoundList = document.querySelector(
      '[data-nbt-path="compoundList"]',
    ) as HTMLElement
    fireEvent.click(within(compoundList).getAllByRole('button')[0])
    const first = document.querySelector('[data-nbt-path="compoundList/0"]') as HTMLElement
    const second = document.querySelector('[data-nbt-path="compoundList/1"]') as HTMLElement
    fireEvent.click(within(first).getAllByRole('button')[0])
    fireEvent.click(within(second).getAllByRole('button')[0])

    // Each `count` leaf is addressable by a distinct, path-qualified name.
    const firstCount = screen.getByRole('button', {
      name: 'Edit value of count (compoundList/0/count)',
    })
    const secondCount = screen.getByRole('button', {
      name: 'Edit value of count (compoundList/1/count)',
    })
    expect(firstCount).not.toBe(secondCount)
    // The ambiguous bare name no longer matches either control.
    expect(screen.queryByRole('button', { name: 'Edit value of count' })).toBeNull()
  })

  it('does not hijack arrow/Enter keys while typing in an inline leaf editor', () => {
    renderStoreTree()
    // Open the intTag value editor and type a new value.
    fireEvent.click(screen.getByRole('button', { name: 'Edit value of intTag (intTag)' }))
    const input = screen.getByRole('textbox', { name: 'Value for intTag (intTag)' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: '100' } })

    // An ArrowRight inside the input must NOT be swallowed by the tree handler
    // (which would expand/collapse or move focus). The input stays open and the
    // value is intact; then Enter still commits via the editor's own handler.
    fireEvent.keyDown(input, { key: 'ArrowRight' })
    expect(screen.getByRole('textbox', { name: 'Value for intTag (intTag)' })).toBeTruthy()
    expect(input.value).toBe('100')

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(getIn(useNbtStore.getState().doc!.root, ['intTag'])).toEqual({
      type: TagType.Int,
      value: 100,
    })
  })

  it('writes the store exactly once when Enter commit is followed by the unmount blur', () => {
    // Wrap setValue with a counting spy BEFORE render so the component captures
    // the spied reference (it reads the action once via the selector).
    const original = useNbtStore.getState().setValue
    let calls = 0
    useNbtStore.setState({
      setValue: (path, value) => {
        calls += 1
        original(path, value)
      },
    })

    renderStoreTree()
    fireEvent.click(screen.getByRole('button', { name: 'Edit value of intTag (intTag)' }))
    const input = screen.getByRole('textbox', { name: 'Value for intTag (intTag)' })
    fireEvent.change(input, { target: { value: '100' } })

    // Enter commits; the input then unmounts and fires blur, which must be a
    // no-op because the commit→blur path is latched like Escape.
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.blur(input)

    expect(calls).toBe(1)
    expect(getIn(useNbtStore.getState().doc!.root, ['intTag'])).toEqual({
      type: TagType.Int,
      value: 100,
    })
  })
})

describe('<NbtTree> keyboard navigation', () => {
  function row(path: string): HTMLElement {
    return document.querySelector(`[data-nbt-path="${path}"]`) as HTMLElement
  }
  // The roving-focus element of a row: the toggle button for a container, or
  // the row <div> (tabIndex set) for a leaf.
  function focusable(path: string): HTMLElement {
    const node = row(path)
    const btn = node.querySelector(':scope > div > button[aria-expanded]')
    if (btn) return btn as HTMLElement
    return node.querySelector(':scope > div[tabindex]') as HTMLElement
  }

  it('exposes WAI-ARIA tree roles: tree, treeitem, group, aria-level', () => {
    render(<NbtTree doc={sampleDocument()} />)
    const tree = screen.getByRole('tree', { name: /NBT tree for Level/ })
    expect(tree).toBeTruthy()
    // Root treeitem is a container with aria-expanded and aria-level 1.
    const rootItem = row('') 
    expect(rootItem.getAttribute('role')).toBe('treeitem')
    expect(rootItem.getAttribute('aria-level')).toBe('1')
    expect(rootItem.getAttribute('aria-expanded')).toBe('true')
    // The expanded root exposes a role=group child list.
    expect(rootItem.querySelector(':scope > ul[role="group"]')).not.toBeNull()
    // A leaf treeitem is level 2 and has no aria-expanded.
    const intTag = row('intTag')
    expect(intTag.getAttribute('role')).toBe('treeitem')
    expect(intTag.getAttribute('aria-level')).toBe('2')
    expect(intTag.getAttribute('aria-expanded')).toBeNull()
  })

  it('keeps exactly one treeitem in the tab order (roving tabindex)', () => {
    render(<NbtTree doc={sampleDocument()} />)
    // Root (default focused) is the only row with tabIndex 0.
    expect(focusable('').getAttribute('tabindex')).toBe('0')
    expect(focusable('intTag').getAttribute('tabindex')).toBe('-1')
    expect(focusable('intList').getAttribute('tabindex')).toBe('-1')

    // Move focus to the first child via an ArrowDown step; the tab stop follows.
    const rootEl = focusable('')
    rootEl.focus()
    fireEvent.keyDown(rootEl, { key: 'ArrowDown' })
    const firstChild = focusable('byteTag')
    expect(firstChild.getAttribute('tabindex')).toBe('0')
    expect(focusable('').getAttribute('tabindex')).toBe('-1')
    expect(document.activeElement).toBe(firstChild)
  })

  it('ArrowRight on a focused collapsed container expands it', () => {
    render(<NbtTree doc={sampleDocument()} />)
    const nested = row('nested')
    const toggle = within(nested).getAllByRole('button')[0]
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(row('nested/label')).toBeNull()

    // The key event originates at the focused row element and bubbles to the
    // tree-level handler, exactly as in a real keyboard interaction.
    toggle.focus()
    fireEvent.keyDown(toggle, { key: 'ArrowRight' })

    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(row('nested/label')).not.toBeNull()
  })

  it('ArrowRight on an already-expanded container moves focus to its first child', () => {
    render(<NbtTree doc={sampleDocument()} />)
    const intList = row('intList')
    const toggle = within(intList).getAllByRole('button')[0]
    // Expand first.
    toggle.focus()
    fireEvent.keyDown(toggle, { key: 'ArrowRight' })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    // ArrowRight again: focus moves to the first child (intList/0).
    fireEvent.keyDown(toggle, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(focusable('intList/0'))
  })

  it('ArrowLeft on an expanded container collapses it', () => {
    render(<NbtTree doc={sampleDocument()} />)
    const nested = row('nested')
    const toggle = within(nested).getAllByRole('button')[0]
    toggle.focus()
    // Expand, then collapse with ArrowLeft.
    fireEvent.keyDown(toggle, { key: 'ArrowRight' })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(row('nested/label')).not.toBeNull()

    fireEvent.keyDown(toggle, { key: 'ArrowLeft' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(row('nested/label')).toBeNull()
  })

  it('ArrowLeft on a leaf moves focus to its parent container', () => {
    render(<NbtTree doc={sampleDocument()} />)
    // Expand intList and focus its first child.
    const intList = row('intList')
    const toggle = within(intList).getAllByRole('button')[0]
    toggle.focus()
    fireEvent.keyDown(toggle, { key: 'ArrowRight' })
    fireEvent.keyDown(toggle, { key: 'ArrowRight' })
    const firstChild = focusable('intList/0')
    expect(document.activeElement).toBe(firstChild)

    // ArrowLeft on the leaf steps back up to intList.
    fireEvent.keyDown(firstChild, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(toggle)
  })

  it('Enter toggles a focused container', () => {
    render(<NbtTree doc={sampleDocument()} />)
    const nested = row('nested')
    const toggle = within(nested).getAllByRole('button')[0]
    toggle.focus()
    fireEvent.keyDown(toggle, { key: 'Enter' })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(toggle, { key: 'Enter' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
  })

  it('Space toggles a focused container', () => {
    render(<NbtTree doc={sampleDocument()} />)
    const nested = row('nested')
    const toggle = within(nested).getAllByRole('button')[0]
    toggle.focus()
    fireEvent.keyDown(toggle, { key: ' ' })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
  })

  it('ArrowDown and ArrowUp move focus between visible nodes', () => {
    render(<NbtTree doc={sampleDocument()} />)
    const rootEl = focusable('')
    rootEl.focus()
    // Down from root -> first child (byteTag).
    fireEvent.keyDown(rootEl, { key: 'ArrowDown' })
    const byteTag = focusable('byteTag')
    expect(document.activeElement).toBe(byteTag)
    // Down again -> shortTag.
    fireEvent.keyDown(byteTag, { key: 'ArrowDown' })
    const shortTag = focusable('shortTag')
    expect(document.activeElement).toBe(shortTag)
    // Up -> back to byteTag.
    fireEvent.keyDown(shortTag, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(focusable('byteTag'))
  })

  it('Home and End jump to the first and last visible node', () => {
    render(<NbtTree doc={sampleDocument()} />)
    const byteTag = focusable('byteTag')
    byteTag.focus()
    fireEvent.keyDown(byteTag, { key: 'End' })
    // Last visible node is the final root child (nested, collapsed).
    expect(document.activeElement).toBe(focusable('nested'))
    fireEvent.keyDown(focusable('nested'), { key: 'Home' })
    expect(document.activeElement).toBe(focusable(''))
  })

  it('mouse toggling still works alongside keyboard navigation', () => {
    render(<NbtTree doc={sampleDocument()} />)
    const nested = row('nested')
    const toggle = within(nested).getAllByRole('button')[0]
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(row('nested/label')).not.toBeNull()
  })
})
