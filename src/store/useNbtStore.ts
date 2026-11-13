import { create } from 'zustand'
import type { NbtDocument, Tag } from '../nbt/types'
import { TagType } from '../nbt/types'
import {
  addIn,
  getIn,
  moveIn,
  removeIn,
  renameIn,
  setValueIn,
  type NbtPath,
  type RemovalRecord,
  type ScalarValue,
} from '../nbt/edit'

/**
 * A single occupant of the graveyard: the edit-core {@link RemovalRecord} for a
 * removed tag plus a stable, monotonically-increasing `id` so React keys and
 * resurrect-by-id stay stable across re-renders and multiple removals of the
 * same key/path.
 */
export interface GraveEntry {
  /** Stable unique id (monotonic counter) for React keys + resurrect(id). */
  id: string
  /** The removal record captured from edit-core's removeIn. */
  record: RemovalRecord
}

interface NbtState {
  fileName: string | null
  doc: NbtDocument | null
  /** Removed tags awaiting resurrection, most-recent last. */
  graveyard: GraveEntry[]
  /** Themed error surfaced when a resurrect cannot land at its original slot. */
  graveyardError: string | null
  load: (fileName: string, doc: NbtDocument) => void
  clear: () => void
  setValue: (path: NbtPath, value: ScalarValue) => void
  rename: (parentPath: NbtPath, oldKey: string, newKey: string) => void
  add: (parentPath: NbtPath, tag: Tag, keyOrIndex?: string | number) => void
  remove: (path: NbtPath) => RemovalRecord | undefined
  move: (path: NbtPath, to: number | string) => void
  /** Restore a graveyard entry to its original parent + ordinal slot. */
  resurrect: (id: string) => void
  /** Dismiss the themed graveyard error. */
  clearGraveyardError: () => void
}

// Monotonic counter for GraveEntry ids. Module-scoped so ids stay unique across
// the store's lifetime (and never collide after load/clear resets the list).
let graveSeq = 0
function nextGraveId(): string {
  graveSeq += 1
  return `grave-${graveSeq}`
}

/** Human-readable rendering of a path for themed error copy. */
function describePath(path: NbtPath): string {
  return path.length === 0 ? '<root>' : path.join('/')
}

export const useNbtStore = create<NbtState>((set, get) => ({
  fileName: null,
  doc: null,
  graveyard: [],
  graveyardError: null,
  load: (fileName, doc) => set({ fileName, doc, graveyard: [], graveyardError: null }),
  clear: () => set({ fileName: null, doc: null, graveyard: [], graveyardError: null }),
  setValue: (path, value) => {
    const { doc } = get()
    if (doc === null) return
    const root = setValueIn(doc.root, path, value)
    set({ doc: { ...doc, root: root as NbtDocument['root'] } })
  },
  rename: (parentPath, oldKey, newKey) => {
    const { doc } = get()
    if (doc === null) return
    const root = renameIn(doc.root, parentPath, oldKey, newKey)
    set({ doc: { ...doc, root: root as NbtDocument['root'] } })
  },
  add: (parentPath, tag, keyOrIndex) => {
    const { doc } = get()
    if (doc === null) return
    const root = addIn(doc.root, parentPath, tag, keyOrIndex)
    set({ doc: { ...doc, root: root as NbtDocument['root'] } })
  },
  remove: (path) => {
    const { doc } = get()
    if (doc === null) return undefined
    const { root, record } = removeIn(doc.root, path)
    // Capture the removal into the graveyard so it can be resurrected later.
    const entry: GraveEntry = { id: nextGraveId(), record }
    set((s) => ({
      doc: { ...doc, root: root as NbtDocument['root'] },
      graveyard: [...s.graveyard, entry],
    }))
    return record
  },
  move: (path, to) => {
    const { doc } = get()
    if (doc === null) return
    const root = moveIn(doc.root, path, to)
    set({ doc: { ...doc, root: root as NbtDocument['root'] } })
  },
  resurrect: (id) => {
    const { doc, graveyard } = get()
    const entry = graveyard.find((e) => e.id === id)
    // Unknown id (already resurrected / stale) or no document: no-op.
    if (entry === undefined || doc === null) return
    const { record } = entry
    const { removed, parentPath, key, index } = record

    // Verify the original parent container still exists and is still the right
    // container kind before mutating. If it is gone (its own grave was dug), we
    // must NOT corrupt the tree: surface a themed error and keep the entry.
    const parent = getIn(doc.root, parentPath)
    const keyLabel = key ?? (index ?? '?')
    if (parent === undefined) {
      set({
        graveyardError: `Cannot resurrect ${keyLabel}: its grave (${describePath(parentPath)}) no longer exists`,
      })
      return
    }
    const needsCompound = key !== undefined
    if (needsCompound && parent.type !== TagType.Compound) {
      set({
        graveyardError: `Cannot resurrect ${keyLabel}: its grave (${describePath(parentPath)}) no longer exists`,
      })
      return
    }
    if (!needsCompound && parent.type !== TagType.List) {
      set({
        graveyardError: `Cannot resurrect ${keyLabel}: its grave (${describePath(parentPath)}) no longer exists`,
      })
      return
    }

    // Re-insert at the original slot. For a List, addIn accepts the original
    // numeric index directly (append when unknown). For a Compound, addIn only
    // appends by key, so we add then move the entry back to its original
    // ordinal position to honor the slot it was removed from. Both edit-core
    // calls are pure and throw before mutating, so a conflict (e.g. the key was
    // re-created meanwhile) is caught and surfaced without corrupting the tree.
    try {
      let root: Tag
      if (key !== undefined) {
        root = addIn(doc.root, parentPath, removed, key)
        // Restore ordinal position within the Compound when known and in range.
        const restored = getIn(root, parentPath)
        if (
          index !== undefined &&
          restored !== undefined &&
          restored.type === TagType.Compound &&
          index < restored.value.size
        ) {
          root = moveIn(root, [...parentPath, key], index)
        }
      } else {
        root = addIn(doc.root, parentPath, removed, index)
      }
      set((s) => ({
        doc: { ...doc, root: root as NbtDocument['root'] },
        graveyard: s.graveyard.filter((e) => e.id !== id),
        graveyardError: null,
      }))
    } catch (err) {
      set({
        graveyardError: `Cannot resurrect ${keyLabel}: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  },
  clearGraveyardError: () => set({ graveyardError: null }),
}))
