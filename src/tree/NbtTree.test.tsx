// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

import { NbtTree } from './NbtTree'
import { sampleDocument } from './sampleDocument'

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
})
