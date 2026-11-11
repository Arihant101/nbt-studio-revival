// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

import { NbtTree, parsePathId } from './NbtTree'
import { sampleDocument } from './sampleDocument'
import type { NbtDocument, Tag } from '../nbt/types'
import { TagType } from '../nbt/types'
import { getIn } from '../nbt/edit'

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
