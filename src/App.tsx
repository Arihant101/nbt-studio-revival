import { useEffect } from 'react'
import { useNbtStore } from './store/useNbtStore'
import { useThemeStore } from './store/useThemeStore'
import { NbtTree } from './tree/NbtTree'
import { sampleDocument } from './tree/sampleDocument'

export default function App() {
  const fileName = useNbtStore((s) => s.fileName)
  const doc = useNbtStore((s) => s.doc)
  const load = useNbtStore((s) => s.load)
  const { theme, toggle } = useThemeStore()
  const spooky = theme === 'spooky'

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  return (
    <main className="min-h-screen bg-bg p-8 font-mono text-fg">
      <header className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-accent">{spooky ? '🎃 ' : ''}NBT Studio Revival</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => load('sample.nbt', sampleDocument())}
            className="rounded border border-edge bg-panel px-3 py-1 text-sm hover:border-accent"
          >
            {spooky ? '🪦 Load sample' : 'Load sample'}
          </button>
          <button
            onClick={toggle}
            className="rounded border border-edge bg-panel px-3 py-1 text-sm hover:border-accent"
          >
            {spooky ? '🌙 Dark mode' : '👻 Spooky mode'}
          </button>
        </div>
      </header>
      <p className="mt-2 text-muted">
        {spooky ? 'The dead NBT editor, raised from the grave.' : 'A browser-based NBT editor for Minecraft Java Edition.'}
      </p>
      {doc ? (
        <section className="mt-8 overflow-auto rounded-lg border border-edge bg-panel p-4">
          {fileName && <p className="mb-2 text-muted">{fileName}</p>}
          <NbtTree doc={doc} />
        </section>
      ) : (
        <section className="mt-8 rounded-lg border-2 border-dashed border-edge bg-panel p-12 text-center">
          {spooky ? 'Feed the chest a .nbt / .dat / .snbt file…' : 'Drop a .nbt / .dat / .snbt file here'}
        </section>
      )}
    </main>
  )
}
