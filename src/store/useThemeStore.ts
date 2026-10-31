import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Theme = 'dark' | 'spooky'

interface ThemeState {
  theme: Theme
  toggle: () => void
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'dark',
      toggle: () => set((s) => ({ theme: s.theme === 'dark' ? 'spooky' : 'dark' })),
    }),
    { name: 'nbt-theme' },
  ),
)
