import { create } from 'zustand'
import type { NbtDocument, Tag } from '../nbt/types'
import {
  addIn,
  moveIn,
  removeIn,
  renameIn,
  setValueIn,
  type NbtPath,
  type RemovalRecord,
  type ScalarValue,
} from '../nbt/edit'

interface NbtState {
  fileName: string | null
  doc: NbtDocument | null
  load: (fileName: string, doc: NbtDocument) => void
  clear: () => void
  setValue: (path: NbtPath, value: ScalarValue) => void
  rename: (parentPath: NbtPath, oldKey: string, newKey: string) => void
  add: (parentPath: NbtPath, tag: Tag, keyOrIndex?: string | number) => void
  remove: (path: NbtPath) => RemovalRecord | undefined
  move: (path: NbtPath, to: number | string) => void
}

export const useNbtStore = create<NbtState>((set, get) => ({
  fileName: null,
  doc: null,
  load: (fileName, doc) => set({ fileName, doc }),
  clear: () => set({ fileName: null, doc: null }),
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
    set({ doc: { ...doc, root: root as NbtDocument['root'] } })
    return record
  },
  move: (path, to) => {
    const { doc } = get()
    if (doc === null) return
    const root = moveIn(doc.root, path, to)
    set({ doc: { ...doc, root: root as NbtDocument['root'] } })
  },
}))
