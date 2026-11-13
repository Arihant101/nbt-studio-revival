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
  /**
   * "Haunted" tag paths: JSON path ids (JSON.stringify(path), matching
   * NbtTree's pathId) of tags edited / added / renamed / moved since the
   * document was loaded or last exported. The tree reads this to mark unsaved
   * tags; {@link NbtState.markExported} clears it. A removed tag is reflected
   * by the graveyard (the node no longer exists in the tree), so remove does
   * NOT add anything here.
   */
  dirty: Set<string>
  /**
   * True when the document has any change (including deletions) since it was
   * loaded or last exported. Drives the "leave page?" guard.
   */
  unsaved: boolean
  /** Increments on every load/clear so views can reset per-document state. */
  docVersion: number
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
  /** Clear all haunted/unsaved paths (called after a successful export). */
  markExported: () => void
}

/**
 * JSON path id for the haunted/dirty set. Must match NbtTree's pathId so the
 * tree can look up membership by the same serialization.
 */
function dirtyId(path: NbtPath): string {
  return JSON.stringify(path)
}

/** Return a new Set with `id` added (keeps updates immutable for React). */
function withDirty(prev: Set<string>, id: string): Set<string> {
  const next = new Set(prev)
  next.add(id)
  return next
}

/**
 * Map a List child index to its new index after a reorder that splices the
 * element out at `from` and back in at `to` (the exact operation moveIn
 * performs). The moved element follows to `to`; elements between `from` and
 * `to` shift by one toward the vacated slot; everything else is unchanged.
 */
function remapListIndex(i: number, from: number, to: number): number {
  if (i === from) return to
  if (from < to) return i > from && i <= to ? i - 1 : i
  // from > to
  return i >= to && i < from ? i + 1 : i
}

/**
 * Rewrite every dirty id that sits under `parentPath` by passing the path
 * segment directly below `parentPath` through `remap`. `remap` returns the new
 * segment, or `null` to drop the id (its node was deleted). Ids elsewhere are
 * kept byte-for-byte. Keeps haunted markers attached to the right nodes after
 * structural edits shift sibling indices or rename keys.
 */
function remapDirtyUnder(
  dirty: Set<string>,
  parentPath: NbtPath,
  remap: (segment: string | number) => string | number | null,
): Set<string> {
  const depth = parentPath.length
  const next = new Set<string>()
  for (const id of dirty) {
    let path: unknown
    try {
      path = JSON.parse(id)
    } catch {
      next.add(id)
      continue
    }
    if (!Array.isArray(path) || path.length <= depth || !parentPath.every((seg, i) => path[i] === seg)) {
      next.add(id)
      continue
    }
    const seg = path[depth] as string | number
    const mapped = remap(seg)
    if (mapped === null) continue
    if (mapped === seg) {
      next.add(id)
      continue
    }
    const remapped = path.slice()
    remapped[depth] = mapped
    next.add(JSON.stringify(remapped))
  }
  return next
}

/** List element removed at `index`: drop its subtree, shift later ones down. */
function dirtyAfterListRemove(dirty: Set<string>, parentPath: NbtPath, index: number): Set<string> {
  return remapDirtyUnder(dirty, parentPath, (seg) =>
    typeof seg !== 'number' ? seg : seg === index ? null : seg > index ? seg - 1 : seg,
  )
}

/** List element inserted at `index`: shift it and later ones up. */
function dirtyAfterListInsert(dirty: Set<string>, parentPath: NbtPath, index: number): Set<string> {
  return remapDirtyUnder(dirty, parentPath, (seg) => (typeof seg === 'number' && seg >= index ? seg + 1 : seg))
}

/**
 * Rebuild the haunted/dirty Set after a List reorder so each dirty id that
 * points at (or passes through) a sibling index under `parentPath` follows its
 * element to its new index. Dirty ids that are not direct numeric children of
 * the moved List parent (Compound-keyed ids, ids under other containers, or ids
 * whose segment at the parent's depth is not a number) are left byte-for-byte
 * unchanged. Re-serialization uses the same JSON.stringify form as dirtyId so
 * ids keep matching NbtTree's pathId.
 */
function remapListDirtyOnMove(
  dirty: Set<string>,
  parentPath: NbtPath,
  from: number,
  to: number,
): Set<string> {
  const depth = parentPath.length
  const next = new Set<string>()
  for (const id of dirty) {
    let path: unknown
    try {
      path = JSON.parse(id)
    } catch {
      next.add(id)
      continue
    }
    // Only remap ids that are arrays reaching at least to the sibling index and
    // that sit directly under the moved List's parentPath.
    if (!Array.isArray(path) || path.length <= depth) {
      next.add(id)
      continue
    }
    let underParent = true
    for (let i = 0; i < depth; i += 1) {
      if (path[i] !== parentPath[i]) {
        underParent = false
        break
      }
    }
    const indexSeg = path[depth]
    if (!underParent || typeof indexSeg !== 'number') {
      next.add(id)
      continue
    }
    const remapped = path.slice()
    remapped[depth] = remapListIndex(indexSeg, from, to)
    next.add(JSON.stringify(remapped))
  }
  return next
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
  dirty: new Set<string>(),
  unsaved: false,
  docVersion: 0,
  load: (fileName, doc) =>
    set((s) => ({
      fileName,
      doc,
      graveyard: [],
      graveyardError: null,
      dirty: new Set<string>(),
      unsaved: false,
      docVersion: s.docVersion + 1,
    })),
  clear: () =>
    set((s) => ({
      fileName: null,
      doc: null,
      graveyard: [],
      graveyardError: null,
      dirty: new Set<string>(),
      unsaved: false,
      docVersion: s.docVersion + 1,
    })),
  setValue: (path, value) => {
    const { doc } = get()
    if (doc === null) return
    const root = setValueIn(doc.root, path, value)
    // The edited leaf is now unsaved: mark its own path haunted.
    set((s) => ({
      doc: { ...doc, root: root as NbtDocument['root'] },
      dirty: withDirty(s.dirty, dirtyId(path)),
      unsaved: true,
    }))
  },
  rename: (parentPath, oldKey, newKey) => {
    const { doc } = get()
    if (doc === null) return
    const root = renameIn(doc.root, parentPath, oldKey, newKey)
    // Renaming to the same key is a no-op: do not mark anything unsaved.
    if (oldKey === newKey) return
    // The renamed entry lives at its new key; mark that resulting path haunted,
    // and carry any haunted descendants over from the old key.
    set((s) => ({
      doc: { ...doc, root: root as NbtDocument['root'] },
      dirty: withDirty(
        remapDirtyUnder(s.dirty, parentPath, (seg) => (seg === oldKey ? newKey : seg)),
        dirtyId([...parentPath, newKey]),
      ),
      unsaved: true,
    }))
  },
  add: (parentPath, tag, keyOrIndex) => {
    const { doc } = get()
    if (doc === null) return
    // Compute the new child's path for the haunted set. For a Compound the key
    // is the slot; for a List, an explicit numeric index is the slot, otherwise
    // an append lands at the pre-add list length (read from the current doc).
    let childPath: NbtPath
    if (keyOrIndex !== undefined) {
      childPath = [...parentPath, keyOrIndex]
    } else {
      const parent = getIn(doc.root, parentPath)
      const appendIndex = parent !== undefined && parent.type === TagType.List ? parent.value.length : 0
      childPath = [...parentPath, appendIndex]
    }
    const root = addIn(doc.root, parentPath, tag, keyOrIndex)
    const slot = childPath[childPath.length - 1]
    set((s) => ({
      doc: { ...doc, root: root as NbtDocument['root'] },
      // Inserting into a List shifts later siblings; keep their markers aligned.
      dirty: withDirty(
        typeof slot === 'number' ? dirtyAfterListInsert(s.dirty, parentPath, slot) : s.dirty,
        dirtyId(childPath),
      ),
      unsaved: true,
    }))
  },
  remove: (path) => {
    const { doc } = get()
    if (doc === null) return undefined
    const { root, record } = removeIn(doc.root, path)
    // Capture the removal into the graveyard so it can be resurrected later.
    const entry: GraveEntry = { id: nextGraveId(), record }
    const last = path[path.length - 1]!
    set((s) => ({
      doc: { ...doc, root: root as NbtDocument['root'] },
      graveyard: [...s.graveyard, entry],
      // Drop markers of the removed subtree; later List siblings shift down.
      dirty:
        typeof last === 'number'
          ? dirtyAfterListRemove(s.dirty, record.parentPath, last)
          : remapDirtyUnder(s.dirty, record.parentPath, (seg) => (seg === last ? null : seg)),
      unsaved: true,
    }))
    return record
  },
  move: (path, to) => {
    const { doc } = get()
    if (doc === null) return
    const root = moveIn(doc.root, path, to)
    // Compute the moved node's resulting path to mark it haunted. In a List the
    // node ends at the numeric target index; in a Compound the key is unchanged
    // (only its ordinal shifts), so the path stays `parentPath + key`.
    const parentPath = path.slice(0, -1) as NbtPath
    const last = path[path.length - 1]
    if (typeof last === 'number' && typeof to === 'number') {
      // List reorder: the positional dirty ids of ALL siblings shift. Remap the
      // existing set so each haunted sibling (and any haunted descendant under
      // one) follows its element to the new index, then mark the moved element.
      set((s) => {
        const remapped = remapListDirtyOnMove(s.dirty, parentPath, last, to)
        return {
          doc: { ...doc, root: root as NbtDocument['root'] },
          dirty: withDirty(remapped, dirtyId([...parentPath, to])),
          unsaved: true,
        }
      })
      return
    }
    // Compound reorder: ids are string-keyed and stable; only the moved key's
    // own path needs marking.
    set((s) => ({
      doc: { ...doc, root: root as NbtDocument['root'] },
      dirty: withDirty(s.dirty, dirtyId([...parentPath, last])),
      unsaved: true,
    }))
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
      let restoredPath: NbtPath = [...parentPath, key ?? index ?? 0]
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
        // Siblings may have been deleted since; clamp so the tag still comes
        // back (at the end) instead of failing with "index out of range".
        const listLength = parent.type === TagType.List ? parent.value.length : 0
        const slot = index === undefined ? listLength : Math.min(index, listLength)
        root = addIn(doc.root, parentPath, removed, slot)
        restoredPath = [...parentPath, slot]
      }
      const finalPath = restoredPath
      set((s) => ({
        doc: { ...doc, root: root as NbtDocument['root'] },
        graveyard: s.graveyard.filter((e) => e.id !== id),
        graveyardError: null,
        // A resurrected tag is an unsaved change: haunt it.
        dirty: withDirty(
          typeof finalPath[finalPath.length - 1] === 'number'
            ? dirtyAfterListInsert(s.dirty, parentPath, finalPath[finalPath.length - 1] as number)
            : s.dirty,
          dirtyId(finalPath),
        ),
        unsaved: true,
      }))
    } catch (err) {
      set({
        graveyardError: `Cannot resurrect ${keyLabel}: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  },
  clearGraveyardError: () => set({ graveyardError: null }),
  markExported: () => set({ dirty: new Set<string>(), unsaved: false }),
}))
