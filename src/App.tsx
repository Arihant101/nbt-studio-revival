import { useEffect } from 'react'
import { useNbtStore } from './store/useNbtStore'
import { useThemeStore } from './store/useThemeStore'

export default function App() {
  const fileName = useNbtStore((s) => s.fileName)
  const { theme, toggle } = useThemeStore()
  const spooky = theme === 'spooky'

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  return (
    <main className="min-h-screen bg-bg p-8 font-mono text-fg">
      <header className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-accent">{spooky ? '🎃 ' : ''}NBT Studio Revival</h1>
        <button
          onClick={toggle}
          className="rounded border border-edge bg-panel px-3 py-1 text-sm hover:border-accent"
        >
          {spooky ? '🌙 Dark mode' : '👻 Spooky mode'}
        </button>
      </header>
      <p className="mt-2 text-muted">
        {spooky ? 'The dead NBT editor, raised from the grave.' : 'A browser-based NBT editor for Minecraft Java Edition.'}
      </p>
      <section className="mt-8 rounded-lg border-2 border-dashed border-edge bg-panel p-12 text-center">
        {fileName ?? (spooky ? 'Feed the chest a .nbt / .dat / .snbt file…' : 'Drop a .nbt / .dat / .snbt file here')}
      </section>
    </main>
  )
}
