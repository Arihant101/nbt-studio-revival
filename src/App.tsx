import { useEffect, useState } from 'react'
import { useNbtStore } from './store/useNbtStore'
import { useThemeStore } from './store/useThemeStore'
import { NbtTree } from './tree/NbtTree'
import { Graveyard } from './tree/Graveyard'
import { sampleDocument } from './tree/sampleDocument'
import { importFile } from './import/importFile'
import { exportDocument } from './export/exportFile'
import type { ExportFormat } from './export/exportFile'
import { triggerDownload } from './export/download'

// Theme-aware copy for the empty-state drop zone, consolidated here rather than
// scattered as ad-hoc ternaries throughout the JSX.
const dropZoneCopy: Record<'dark' | 'spooky', string> = {
  dark: 'Drop a .nbt / .dat / .snbt file here',
  spooky: 'Feed the chest a .nbt / .dat / .snbt file…',
}

// Séance search (Task 10, increment C). Themed placeholder + accessible label
// for the search box, routed through copy maps rather than ad-hoc ternaries.
// The dark variant is a plain filter; spooky re-skins it as a "séance" with a
// lantern glyph, while the behavior is identical in both themes.
const searchPlaceholderCopy: Record<'dark' | 'spooky', string> = {
  dark: 'Search keys and values',
  spooky: '🔦 Séance: search keys and values',
}
const searchLabelCopy: Record<'dark' | 'spooky', string> = {
  dark: 'Search tags',
  spooky: 'Séance search',
}
const searchClearCopy: Record<'dark' | 'spooky', string> = {
  dark: 'Clear search',
  spooky: 'Snuff the lantern (clear search)',
}

export default function App() {
  const fileName = useNbtStore((s) => s.fileName)
  const doc = useNbtStore((s) => s.doc)
  const load = useNbtStore((s) => s.load)
  const markExported = useNbtStore((s) => s.markExported)
  const { theme, toggle } = useThemeStore()
  const spooky = theme === 'spooky'

  // Local UI state for import: whether a file is currently dragged over the app
  // (drives the 'drop here' visual) and the latest import error message.
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Séance search query. View-local (never persisted in the store); threaded
  // into NbtTree which highlights matches and force-expands their ancestors.
  const [search, setSearch] = useState('')

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

  // Export the current doc in the chosen format and trigger a browser download.
  // Read-only over the doc: it is never mutated here, and a failure surfaces the
  // serializer/download error without altering the loaded document.
  async function handleExport(format: ExportFormat) {
    if (doc === null) return
    try {
      const result = await exportDocument(doc, fileName, format)
      triggerDownload(result)
      // A successful export is the "save": clear the haunted/unsaved state so
      // the tree no longer marks those tags. On failure (caught below) the
      // dirty set is left intact so the user still sees what changed.
      markExported()
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
          {doc && (
            <>
              <button
                onClick={() => void handleExport('binary')}
                aria-label="Export .nbt"
                className="rounded border border-edge bg-panel px-3 py-1 text-sm hover:border-accent focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
              >
                {spooky ? '🧟 Export .nbt' : 'Export .nbt'}
              </button>
              <button
                onClick={() => void handleExport('snbt')}
                aria-label="Export .snbt"
                className="rounded border border-edge bg-panel px-3 py-1 text-sm hover:border-accent focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
              >
                {spooky ? '🧟 Export .snbt' : 'Export .snbt'}
              </button>
            </>
          )}
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
        <>
          <section className="mt-8 overflow-auto rounded-lg border border-edge bg-panel p-4">
            {fileName && <p className="mb-2 text-muted">{fileName}</p>}
            <div className="mb-3 flex items-center gap-2">
              <input
                type="search"
                value={search}
                aria-label={searchLabelCopy[theme]}
                placeholder={searchPlaceholderCopy[theme]}
                onChange={(e) => setSearch(e.target.value)}
                className="flex-1 rounded border border-edge bg-bg px-2 py-1 text-sm text-fg placeholder:text-muted focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
              />
              <button
                type="button"
                onClick={() => setSearch('')}
                disabled={search === ''}
                aria-label={searchClearCopy[theme]}
                className="rounded border border-edge bg-panel px-3 py-1 text-sm hover:border-accent focus:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                {spooky ? '🔦 Clear' : 'Clear'}
              </button>
            </div>
            <NbtTree doc={doc} query={search} />
          </section>
          <Graveyard />
        </>
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
