// @vitest-environment jsdom
//
// Component tests (Task 8) for the import UI in App: picking a binary file via
// the file <input>, dropping an .snbt text file on the app, a non-Compound
// SNBT root surfacing a themed error without loading, and a corrupted import
// leaving a previously-loaded doc intact. Follows the StructureControls.test
// pattern: clear the shared store in beforeEach, cleanup()+clear() in afterEach.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

describe('App import: cursed file surfaces the parse location', () => {
  it('shows a role=alert with the located character offset and does not load', async () => {
    render(<App />)
    // '{a:1}' parses as a valid Compound, then the trailing 'trailing' makes
    // the SNBT parser throw 'Unexpected trailing characters at position 5'.
    dropFiles([new File(['{a:1}trailing'], 'cursed.snbt')])

    const alert = await screen.findByRole('alert')
    expect(alert.className).toContain('text-danger')
    // The original parser message is preserved (existing contract).
    expect(alert.textContent).toContain('trailing characters')
    // The located character offset is surfaced prominently.
    expect(alert.textContent).toContain('character 5')
    // A failed import never loads a doc.
    expect(useNbtStore.getState().doc).toBeNull()
  })
})

describe('App export: control presence', () => {
  it('does not render the export buttons when no document is loaded', () => {
    render(<App />)
    expect(screen.queryByRole('button', { name: /Export \.nbt/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Export \.snbt/ })).toBeNull()
  })

  it('renders keyboard-accessible export buttons after a document loads', () => {
    useNbtStore.getState().load('sample.nbt', sampleDocument())
    render(<App />)

    const binary = screen.getByRole('button', { name: /Export \.nbt/ })
    const snbt = screen.getByRole('button', { name: /Export \.snbt/ })
    expect(binary.tagName).toBe('BUTTON')
    expect(snbt.tagName).toBe('BUTTON')
  })
})

describe('App export: failed export surfaces a themed alert and keeps the doc', () => {
  it('shows the danger alert, leaves the loaded doc intact, and does not crash', async () => {
    // Force triggerDownload to throw deterministically: stub URL.createObjectURL
    // (whether or not jsdom provides it) so clicking Export .nbt makes
    // handleExport catch the error into the themed role=alert danger paragraph.
    // Restored in finally so other tests are unaffected. The doc is read-only
    // through export, so it must remain loaded with its fileName untouched.
    const original = globalThis.URL.createObjectURL
    const spy = vi.fn(() => {
      throw new Error('object URL unavailable')
    })
    globalThis.URL.createObjectURL = spy as unknown as typeof URL.createObjectURL
    try {
      useNbtStore.getState().load('sample.nbt', sampleDocument())
      render(<App />)

      fireEvent.click(screen.getByRole('button', { name: /Export \.nbt/ }))

      const alert = await screen.findByRole('alert')
      expect(alert.className).toContain('text-danger')
      expect(spy).toHaveBeenCalled()

      // The loaded doc is unchanged by the failed export.
      expect(useNbtStore.getState().doc).not.toBeNull()
      expect(useNbtStore.getState().fileName).toBe('sample.nbt')
    } finally {
      globalThis.URL.createObjectURL = original
    }
  })
})

describe('App haunted tags: unsaved-edit marker set on edit, cleared on export', () => {
  it('marks an edited leaf as haunted, then clears it after a successful export', async () => {
    // Stub the object-URL APIs so triggerDownload succeeds in jsdom and the
    // export resolves, exercising the markExported() success path.
    const origCreate = globalThis.URL.createObjectURL
    const origRevoke = globalThis.URL.revokeObjectURL
    globalThis.URL.createObjectURL = vi.fn(
      () => 'blob:stub',
    ) as unknown as typeof URL.createObjectURL
    globalThis.URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL
    try {
      useNbtStore.getState().load('sample.nbt', sampleDocument())
      render(<App />)

      // No haunted markers before any edit (dark theme marker label).
      expect(screen.queryAllByText('modified (unsaved)')).toHaveLength(0)

      // Edit the top-level intTag leaf through its inline editor so its path
      // becomes dirty.
      fireEvent.click(screen.getByRole('button', { name: 'Edit value of intTag (intTag)' }))
      const input = screen.getByRole('textbox', { name: 'Value for intTag (intTag)' })
      fireEvent.change(input, { target: { value: '99' } })
      fireEvent.keyDown(input, { key: 'Enter' })

      // The haunted indicator appears (static sr-only label, not animation).
      await waitFor(() => {
        expect(screen.getAllByText('modified (unsaved)').length).toBeGreaterThan(0)
      })
      expect(useNbtStore.getState().dirty.size).toBeGreaterThan(0)

      // A successful export clears the haunted/unsaved state.
      fireEvent.click(screen.getByRole('button', { name: /Export \.nbt/ }))
      await waitFor(() => {
        expect(useNbtStore.getState().dirty.size).toBe(0)
      })
      expect(screen.queryAllByText('modified (unsaved)')).toHaveLength(0)
    } finally {
      globalThis.URL.createObjectURL = origCreate
      globalThis.URL.revokeObjectURL = origRevoke
    }
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
