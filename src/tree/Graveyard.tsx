// Graveyard panel = the undo system (Task 10, increment A).
//
// Lists every tag removed from the loaded document (captured by the store's
// remove action as a GraveEntry wrapping edit-core's RemovalRecord) and offers
// a real, keyboard-accessible "Resurrect" button per entry that restores the
// tag to its original parent + ordinal slot via the store's resurrect action.
//
// Works in BOTH themes: all themed copy/headings/button labels route through a
// Record<'dark' | 'spooky', ...> copy map (never ad-hoc ternaries), and every
// color uses only the semantic Tailwind token utilities (never raw hex), so the
// dark "Deleted (undo)" list and the spooky "Graveyard" of tombstones share one
// code path. No animation is added here, so prefers-reduced-motion is respected
// by construction; the tombstone glyph/sigils convey state statically. Tag
// type glyphs/labels route through the tagDisplay helper.

import type { Theme } from '../store/useThemeStore'
import { useThemeStore } from '../store/useThemeStore'
import { useNbtStore, type GraveEntry } from '../store/useNbtStore'
import type { RemovalRecord } from '../nbt/edit'
import { tagDisplay } from './tagDisplay'

/** Themed copy for headings and controls, one entry per theme (no ternaries). */
const COPY: Record<Theme, { heading: string; resurrect: string; empty: string; dismiss: string }> =
  {
    dark: {
      heading: 'Deleted (undo)',
      resurrect: 'Restore',
      empty: 'Nothing deleted yet.',
      dismiss: 'Dismiss',
    },
    spooky: {
      heading: '🪦 Graveyard',
      resurrect: 'Resurrect',
      empty: 'The graveyard is empty… for now.',
      dismiss: 'Dismiss',
    },
  }

/** Per-theme glyph marking each grave (static; conveys "deleted" at a glance). */
const GRAVE_GLYPH: Record<Theme, string> = {
  dark: '•',
  spooky: '🪦',
}

/**
 * Human-readable slot description for a removed tag: its Compound key or List
 * index, plus the parent path. Mirrors the tree's `/`-joined display form so an
 * entry reads as the same address the user deleted it from.
 */
function describeSlot(record: RemovalRecord): string {
  const parent = record.parentPath.length === 0 ? '<root>' : record.parentPath.join('/')
  if (record.key !== undefined) {
    return `${record.key} (in ${parent})`
  }
  return `[${record.index ?? '?'}] (in ${parent})`
}

/**
 * Path-qualified accessible name for a Resurrect button so each button is
 * tree-wide unique even when the same key was deleted from several parents.
 * Mirrors accessibleName() in StructureControls/EditableLeafValue.
 */
function resurrectName(verb: string, record: RemovalRecord): string {
  const slotKey = record.key !== undefined ? record.key : `[${record.index ?? '?'}]`
  const parent = record.parentPath.length === 0 ? '' : `/${record.parentPath.join('/')}`
  return `${verb} ${slotKey}${parent}`
}

interface GraveRowProps {
  entry: GraveEntry
  theme: Theme
}

function GraveRow({ entry, theme }: GraveRowProps) {
  const resurrect = useNbtStore((s) => s.resurrect)
  const display = tagDisplay(entry.record.removed.type, theme)
  const copy = COPY[theme]

  return (
    <li className="flex items-center justify-between gap-2 rounded border border-edge bg-bg px-2 py-1">
      <span className="flex min-w-0 items-center gap-2">
        <span aria-hidden="true">{GRAVE_GLYPH[theme]}</span>
        <span aria-hidden="true" className={display.color}>
          {display.sigil}
        </span>
        <span className="truncate text-fg">
          <span className={display.color}>{display.label}</span>{' '}
          <span className="text-muted">{describeSlot(entry.record)}</span>
        </span>
      </span>
      <button
        type="button"
        onClick={() => resurrect(entry.id)}
        aria-label={resurrectName(copy.resurrect, entry.record)}
        className="shrink-0 rounded border border-edge px-2 py-0.5 text-accent hover:bg-panel focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
      >
        ↩ {copy.resurrect}
      </button>
    </li>
  )
}

/**
 * The Graveyard panel. Renders the themed heading, the themed resurrect error
 * (if any) as a dismissible role="alert", and the list of graves. Returns null
 * when no document is loaded so the empty app stays clean.
 */
export function Graveyard() {
  const doc = useNbtStore((s) => s.doc)
  const graveyard = useNbtStore((s) => s.graveyard)
  const graveyardError = useNbtStore((s) => s.graveyardError)
  const clearGraveyardError = useNbtStore((s) => s.clearGraveyardError)
  const theme = useThemeStore((s) => s.theme)

  if (doc === null) return null
  const copy = COPY[theme]

  return (
    <section
      aria-label={copy.heading}
      className="mt-4 rounded-lg border border-edge bg-panel p-4"
    >
      <h2 className="mb-2 font-bold text-accent">{copy.heading}</h2>
      {graveyardError !== null && (
        <div
          role="alert"
          className="mb-2 flex items-center justify-between gap-2 rounded border border-danger px-2 py-1 text-danger"
        >
          <span>{graveyardError}</span>
          <button
            type="button"
            onClick={clearGraveyardError}
            aria-label={copy.dismiss}
            className="shrink-0 rounded border border-danger px-2 py-0.5 text-danger hover:bg-bg focus:outline-none focus-visible:ring-1 focus-visible:ring-danger"
          >
            ✕
          </button>
        </div>
      )}
      {graveyard.length === 0 ? (
        <p className="text-muted">{copy.empty}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {graveyard.map((entry) => (
            <GraveRow key={entry.id} entry={entry} theme={theme} />
          ))}
        </ul>
      )}
    </section>
  )
}
