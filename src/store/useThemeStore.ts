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
    {
      name: 'nbt-theme',
      // localStorage is user-editable: never trust a persisted value that is
      // not one of the known themes (it is used as a lookup key and written to
      // <html data-theme>).
      merge: (persisted, current) => {
        const theme = (persisted as { theme?: unknown } | null)?.theme
        return theme === 'dark' || theme === 'spooky' ? { ...current, theme } : current
      },
    },
  ),
)
