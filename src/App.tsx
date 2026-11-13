import { useEffect, useState } from 'react'
import { Analytics } from '@vercel/analytics/react'
import { useNbtStore } from './store/useNbtStore'
import { useThemeStore } from './store/useThemeStore'
import { NbtTree } from './tree/NbtTree'
import { Graveyard } from './tree/Graveyard'
import { sampleDocument } from './tree/sampleDocument'
import { computeMatches } from './tree/searchMatch'
import { ACCEPTED_EXTENSIONS, importFile } from './import/importFile'
import { parseErrorLocation } from './import/parseErrorLocation'
import type { ParseErrorLocation } from './import/parseErrorLocation'
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
// Empty-state copy when an active séance search yields zero matches. Each line
// names the actionable next step (clear the search), which the always-present
// Clear button performs. Rendered with the text-muted semantic token because
// this is an empty state, not an error. Routed through a copy map (never
// ad-hoc ternaries), mirroring the other search copy maps above.
const searchNoMatchCopy: Record<'dark' | 'spooky', string> = {
  dark: 'No matches — clear the search to see all tags',
  spooky: 'The séance found nothing — snuff the lantern to see all tags',
}

// Cursed file (Task 10, increment D). A failed import surfaces the parser's
// message AND, when the SNBT parser reported a character offset, a prominent
// located line. Themed copy/markers route through these maps rather than
// ad-hoc ternaries. In spooky mode the located line carries a "cracked" marker
// glyph at the bad spot; in dark mode it is a plain "Parse error at character N".
type ImportError = { message: string; location: ParseErrorLocation }

// Leading marker glyph for the located line. Static (no animation) so it stays
// perceivable under prefers-reduced-motion; the optional pulse is layered via
// the .nbt-crack class, gated in index.css.
const crackMarkerCopy: Record<'dark' | 'spooky', string> = {
  dark: '',
  spooky: '🩸 ',
}
// Themed templates for the located-offset sentence, routed through a copy map
// (one entry per theme) rather than an ad-hoc ternary. Each takes the character
// position and returns the full line; spooky adds a "cracked here" phrasing.
const locatedCopy: Record<'dark' | 'spooky', (position: number) => string> = {
  dark: (position) => `Parse error at character ${position}`,
  spooky: (position) => `cracked here, parse error at character ${position}`,
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
  const [error, setError] = useState<ImportError | null>(null)
  // Séance search query. View-local (never persisted in the store); threaded
  // into NbtTree which highlights matches and force-expands their ancestors.
  const [search, setSearch] = useState('')

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // Séance no-match detection. When a doc is loaded and the search query is
  // active (non-empty after trim) but yields zero matches, show a themed
  // muted empty-state message. Reuses computeMatches (the SAME matcher the
  // tree uses) rather than duplicating matching logic.
  const normalizedQuery = search.trim().toLowerCase()
  const searchActive = normalizedQuery !== ''
  const hasNoMatches =
    doc !== null && searchActive && computeMatches(doc.root, normalizedQuery).matches.size === 0

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
      // Keep the original parser message (the existing role=alert contract) and
      // derive the located character offset for the cursed-file surface. A
      // failed import never calls load, so any previously-loaded doc is intact.
      const message = err instanceof Error ? err.message : String(err)
      setError({ message, location: parseErrorLocation(err) })
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
      const message = err instanceof Error ? err.message : String(err)
      setError({ message, location: { kind: 'none' } })
    }
  }

  return (
    <>
      <Analytics />
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
              accept={ACCEPTED_EXTENSIONS}
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
        <div role="alert" className="mt-4 rounded border border-danger px-3 py-2 text-danger">
          <p>{error.message}</p>
          {error.location.kind === 'position' && (
            <p className="mt-1 flex items-center gap-1 text-danger">
              {spooky && (
                <span className="nbt-crack" aria-hidden="true">
                  {crackMarkerCopy[theme]}
                </span>
              )}
              <span className="font-bold">{locatedCopy[theme](error.location.position)}</span>
            </p>
          )}
        </div>
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
            {hasNoMatches && (
              <p className="mb-3 text-muted">{searchNoMatchCopy[theme]}</p>
            )}
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
    </>
  )
}
