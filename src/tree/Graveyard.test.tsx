// @vitest-environment jsdom
//
// Component tests (Task 10, increment A) for the Graveyard undo panel. Follows
// the App.test / StructureControls.test pattern: clear the shared store in
// beforeEach, cleanup()+clear() in afterEach. Loads sampleDocument into the
// store, deletes a node so it appears in the graveyard, asserts a path-qualified
// Resurrect button exists, clicks it, and asserts the entry is gone and the tag
// is restored to the store.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { Graveyard } from './Graveyard'
import { sampleDocument } from './sampleDocument'
import { useNbtStore } from '../store/useNbtStore'
import { useThemeStore } from '../store/useThemeStore'
import { getIn } from '../nbt/edit'
import { TagType } from '../nbt/types'

beforeEach(() => {
  useNbtStore.getState().clear()
  // Start from the default dark theme for deterministic copy.
  useThemeStore.setState({ theme: 'dark' })
})
afterEach(() => {
  cleanup()
  useNbtStore.getState().clear()
  useThemeStore.setState({ theme: 'dark' })
})

describe('Graveyard panel', () => {
  it('renders nothing when no document is loaded', () => {
    const { container } = render(<Graveyard />)
    expect(container.firstChild).toBeNull()
  })

  it('shows a deleted tag with a path-qualified Resurrect button and restores it on click', () => {
    useNbtStore.getState().load('sample.nbt', sampleDocument())
    // Delete a nested leaf so the button's accessible name is path-qualified.
    useNbtStore.getState().remove(['nested', 'label'])

    render(<Graveyard />)

    // Dark-theme heading copy.
    expect(screen.getByRole('heading', { name: 'Deleted (undo)' })).toBeTruthy()

    // The Resurrect button carries a path-qualified accessible name.
    const button = screen.getByRole('button', { name: 'Restore label/nested' })
    expect(button).toBeTruthy()

    fireEvent.click(button)

    // The entry is gone from the graveyard...
    expect(useNbtStore.getState().graveyard).toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Restore label/nested' })).toBeNull()
    // ...and the tag is back in the store at its original slot.
    const doc = useNbtStore.getState().doc!
    expect(getIn(doc.root, ['nested', 'label'])).toEqual({
      type: TagType.String,
      value: 'deeply nested',
    })
  })

  it('surfaces a dismissible themed error when the original location is gone', () => {
    const store = useNbtStore.getState()
    store.load('sample.nbt', sampleDocument())
    store.remove(['nested', 'inner', 'leaf'])
    const leafId = useNbtStore.getState().graveyard.find((e) => e.record.key === 'leaf')!.id
    // Remove the whole `nested` compound so leaf's grave no longer exists.
    store.remove(['nested'])

    render(<Graveyard />)

    const button = screen.getByRole('button', { name: 'Restore leaf/nested/inner' })
    fireEvent.click(button)

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('leaf')
    // Entry remains in the graveyard (not restored).
    expect(useNbtStore.getState().graveyard.some((e) => e.id === leafId)).toBe(true)

    // Dismiss clears the error.
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('uses spooky copy when the spooky theme is active', () => {
    useThemeStore.setState({ theme: 'spooky' })
    useNbtStore.getState().load('sample.nbt', sampleDocument())
    useNbtStore.getState().remove(['intTag'])

    render(<Graveyard />)

    expect(screen.getByRole('heading', { name: '🪦 Graveyard' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Resurrect intTag' })).toBeTruthy()
  })
})
