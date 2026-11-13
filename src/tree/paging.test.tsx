// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { CHILD_PAGE_SIZE, NbtTree } from './NbtTree'
import type { NbtDocument, Tag } from '../nbt/types'
import { TagType } from '../nbt/types'

afterEach(cleanup)

function bigListDoc(n: number): NbtDocument {
  const value: Tag[] = Array.from({ length: n }, (_, i) => ({ type: TagType.Int, value: i }))
  return {
    name: 'big',
    compression: 'none',
    root: { type: TagType.Compound, value: new Map([['blocks', { type: TagType.List, elementType: TagType.Int, value }]]) },
  }
}

describe('large containers page in', () => {
  it(`renders only ${CHILD_PAGE_SIZE} children until "Show more" is pressed`, () => {
    const total = CHILD_PAGE_SIZE + 50
    render(<NbtTree doc={bigListDoc(total)} />)
    fireEvent.click(document.querySelector('[data-nbt-path="blocks"] button')!)
    const rows = () => document.querySelectorAll('[data-nbt-path^="blocks/"]').length
    expect(rows()).toBe(CHILD_PAGE_SIZE)
    fireEvent.click(screen.getByRole('button', { name: /Show 50 more \(50 hidden\)/ }))
    expect(rows()).toBe(total)
    expect(screen.queryByRole('button', { name: /Show .* more/ })).toBeNull()
  })
})
