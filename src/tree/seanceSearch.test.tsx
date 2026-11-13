// @vitest-environment jsdom
//
// Component test (Task 10, increment C) for the séance search box in App: load
// the sample doc, type a query that matches a deeply-nested VALUE, assert the
// matching node is highlighted and its (collapsed-by-default) ancestor is
// force-expanded/visible, assert a non-matching sibling is dimmed, then clear
// the search and assert highlight/dim is removed and the tree reverts. Follows
// the App.test / StructureControls.test store-isolation pattern.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import App from '../App'
import { sampleDocument } from './sampleDocument'
import { useNbtStore } from '../store/useNbtStore'

beforeEach(() => {
  useNbtStore.getState().load('Level', sampleDocument())
})
afterEach(() => {
  cleanup()
  useNbtStore.getState().clear()
})

describe('App séance search', () => {
  it('has a keyboard-accessible search input and a Clear button', () => {
    render(<App />)
    expect(screen.getByRole('searchbox', { name: 'Search tags' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Clear search' })).toBeTruthy()
  })

  it('highlights a deeply-nested value match, force-expands its ancestor, and dims a non-match', () => {
    render(<App />)
    const input = screen.getByRole('searchbox', { name: 'Search tags' })

    // compoundList is collapsed by default, so its [0] entry is not mounted.
    expect(document.querySelector('[data-nbt-path="compoundList/0"]')).toBeNull()

    // 'minecraft:stone' only exists as the VALUE of compoundList[0].id.
    fireEvent.change(input, { target: { value: 'minecraft:stone' } })

    // The ancestor container is force-expanded so the match is visible.
    expect(document.querySelector('[data-nbt-path="compoundList/0"]')).not.toBeNull()
    const matchNode = document.querySelector(
      '[data-nbt-path="compoundList/0/id"]',
    ) as HTMLElement
    expect(matchNode).not.toBeNull()
    expect(matchNode.getAttribute('data-search-match')).toBe('true')

    // A non-matching top-level sibling (intTag) is dimmed, not hidden.
    const dimmed = document.querySelector('[data-nbt-path="intTag"]') as HTMLElement
    expect(dimmed).not.toBeNull()
    expect(dimmed.getAttribute('data-search-dim')).toBe('true')

    // Dimmed/match state must not aria-hide real content from assistive tech.
    expect(dimmed.getAttribute('aria-hidden')).toBeNull()
  })

  it('also matches by KEY (not only value)', () => {
    render(<App />)
    const input = screen.getByRole('searchbox', { name: 'Search tags' })
    fireEvent.change(input, { target: { value: 'stringTag' } })

    const matchNode = document.querySelector('[data-nbt-path="stringTag"]') as HTMLElement
    expect(matchNode.getAttribute('data-search-match')).toBe('true')
  })

  it('clears via the Clear button: removes highlight/dim and reverts expansion', () => {
    render(<App />)
    const input = screen.getByRole('searchbox', { name: 'Search tags' }) as HTMLInputElement

    fireEvent.change(input, { target: { value: 'minecraft:stone' } })
    expect(document.querySelector('[data-search-match="true"]')).not.toBeNull()
    expect(document.querySelector('[data-search-dim="true"]')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))

    // The input is emptied, all highlight/dim styling is gone, and the
    // force-expanded ancestor collapses back to its manual (default) state.
    expect(input.value).toBe('')
    expect(document.querySelector('[data-search-match="true"]')).toBeNull()
    expect(document.querySelector('[data-search-dim="true"]')).toBeNull()
    expect(document.querySelector('[data-nbt-path="compoundList/0"]')).toBeNull()
  })

  it('clears equivalently when the input is emptied directly', () => {
    render(<App />)
    const input = screen.getByRole('searchbox', { name: 'Search tags' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'stringTag' } })
    expect(document.querySelector('[data-search-match="true"]')).not.toBeNull()

    fireEvent.change(input, { target: { value: '' } })
    expect(document.querySelector('[data-search-match="true"]')).toBeNull()
    expect(document.querySelector('[data-search-dim="true"]')).toBeNull()
  })
})
