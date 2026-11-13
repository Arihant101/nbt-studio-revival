import { useEffect, useState } from 'react'
import { useNbtStore } from './store/useNbtStore'
import { useThemeStore } from './store/useThemeStore'
import { NbtTree } from './tree/NbtTree'
import { sampleDocument } from './tree/sampleDocument'
import { importFile } from './import/importFile'

// Theme-aware copy for the empty-state drop zone, consolidated here rather than
// scattered as ad-hoc ternaries throughout the JSX.
const dropZoneCopy: Record<'dark' | 'spooky', string> = {
  dark: 'Drop a .nbt / .dat / .snbt file here',
  spooky: 'Feed the chest a .nbt / .dat / .snbt file…',
}

export default function App() {
  const fileName = useNbtStore((s) => s.fileName)
  const doc = useNbtStore((s) => s.doc)
  const load = useNbtStore((s) => s.load)
  const { theme, toggle } = useThemeStore()
  const spooky = theme === 'spooky'

  // Local UI state for import: whether a file is currently dragged over the app
  // (drives the 'drop here' visual) and the latest import error message.
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // Import the first file from a picker/drop. On success route it through the
  // store's load so the existing NbtTree renders it; on failure surface the
  // parser's message and DO NOT call load, leaving any current doc intact.
  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const file = files[0]
    try {
      const imported = await importFile(file)
      load(file.name, imported)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <main
      className="min-h-screen bg-bg p-8 font-mono text-fg"
      onDragOver={(e) => {
        // Prevent the browser from navigating to the dropped file and show the
        // drag-over visual state.
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        void handleFiles(e.dataTransfer.files)
      }}
    >
      <header className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-accent">{spooky ? '🎃 ' : ''}NBT Studio Revival</h1>
        <div className="flex items-center gap-2">
          <label className="cursor-pointer rounded border border-edge bg-panel px-3 py-1 text-sm hover:border-accent focus-within:border-accent">
            {spooky ? '📂 Import' : 'Import'}
            <input
              type="file"
              accept=".nbt,.dat,.snbt"
              aria-label="Import NBT file"
              onChange={(e) => {
                void handleFiles(e.target.files)
                // Reset so re-picking the same file fires change again.
                e.target.value = ''
              }}
              className="sr-only"
            />
          </label>
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
      {error !== null && (
        <p role="alert" className="mt-4 rounded border border-danger px-3 py-2 text-danger">
          {error}
        </p>
      )}
      {doc ? (
        <section className="mt-8 overflow-auto rounded-lg border border-edge bg-panel p-4">
          {fileName && <p className="mb-2 text-muted">{fileName}</p>}
          <NbtTree doc={doc} />
        </section>
      ) : (
        <section
          className={`mt-8 rounded-lg border-2 border-dashed p-12 text-center ${
            dragOver ? 'border-accent bg-bg' : 'border-edge bg-panel'
          }`}
        >
          {dropZoneCopy[theme]}
        </section>
      )}
    </main>
  )
}
