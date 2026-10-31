import { create } from 'zustand'
import type { NbtDocument } from '../nbt/types'

interface NbtState {
  fileName: string | null
  doc: NbtDocument | null
  load: (fileName: string, doc: NbtDocument) => void
  clear: () => void
}

// TODO(Kiro spec task 4): edit actions (setValue, rename, add, remove, move) keyed by tag path.
export const useNbtStore = create<NbtState>((set) => ({
  fileName: null,
  doc: null,
  load: (fileName, doc) => set({ fileName, doc }),
  clear: () => set({ fileName: null, doc: null }),
}))
