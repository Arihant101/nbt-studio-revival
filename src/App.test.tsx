// @vitest-environment jsdom
//
// Component tests (Task 8) for the import UI in App: picking a binary file via
// the file <input>, dropping an .snbt text file on the app, a non-Compound
// SNBT root surfacing a themed error without loading, and a corrupted import
// leaving a previously-loaded doc intact. Follows the StructureControls.test
// pattern: clear the shared store in beforeEach, cleanup()+clear() in afterEach.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import App from './App'
import { serializeBinary } from './nbt/binary'
import { sampleDocument } from './tree/sampleDocument'
import { useNbtStore } from './store/useNbtStore'

beforeEach(() => {
  useNbtStore.getState().clear()
})
afterEach(() => {
  cleanup()
  useNbtStore.getState().clear()
})

/** Fire a drop on the outer <main> with a dataTransfer carrying `files`. */
function dropFiles(files: File[]) {
  const main = document.querySelector('main') as HTMLElement
  fireEvent.drop(main, { dataTransfer: { files } })
}

describe('App import: file picker', () => {
  it('loads a binary file picked via the file input', async () => {
    const bytes = await serializeBinary(sampleDocument())
    render(<App />)

    const input = screen.getByLabelText('Import NBT file') as HTMLInputElement
    // Copy into a fresh ArrayBuffer-backed view so it is a valid BlobPart
    // (serializeBinary's return is typed Uint8Array<ArrayBufferLike>).
    const buffer = new ArrayBuffer(bytes.length)
    new Uint8Array(buffer).set(bytes)
    const file = new File([buffer], 'level.dat')
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(useNbtStore.getState().doc).not.toBeNull()
    })
    expect(useNbtStore.getState().fileName).toBe('level.dat')
  })
})

describe('App import: drag-and-drop', () => {
  it('loads an .snbt text file dropped on the app', async () => {
    render(<App />)
    dropFiles([new File(['{a:1}'], 'data.snbt')])

    await waitFor(() => {
      expect(useNbtStore.getState().doc).not.toBeNull()
    })
    expect(useNbtStore.getState().fileName).toBe('data.snbt')
  })

  it('surfaces a role=alert error for a non-Compound SNBT root and does not load', async () => {
    render(<App />)
    dropFiles([new File(['[1,2,3]'], 'bad.snbt')])

    const alert = await screen.findByRole('alert')
    expect(alert.className).toContain('text-danger')
    expect(alert.textContent).toContain('Compound')
    expect(useNbtStore.getState().doc).toBeNull()
  })
})

describe('App import: failed import keeps the previous doc', () => {
  it('shows an error and leaves a previously-loaded doc intact on a corrupted import', async () => {
    // Seed a known-good doc first.
    useNbtStore.getState().load('sample.nbt', sampleDocument())
    render(<App />)

    dropFiles([new File([new Uint8Array([0xff, 0x00])], 'bad.nbt')])

    const alert = await screen.findByRole('alert')
    expect(alert.className).toContain('text-danger')

    // The previously-loaded doc is unchanged.
    expect(useNbtStore.getState().doc).not.toBeNull()
    expect(useNbtStore.getState().fileName).toBe('sample.nbt')
  })
})
