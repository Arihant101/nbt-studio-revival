// Inline value editor for a leaf NBT tag, rendered inside the tree's leaf
// branch (Task 6). A leaf's value is activatable (click OR keyboard) to open an
// input seeded with the tag's FULL current value; committing (Enter / blur /
// the ✓ confirm button) routes through useNbtStore.setValue(path, value) with
// the leaf's real NbtPath. Escape cancels and reverts.
//
// The only commit path is the store action. edit-core's setValueIn is pure and
// THROWS (before producing any new tree) on invalid input, and the store lets
// that throw propagate, so a caught throw leaves the doc untouched (no
// corruption). We wrap BOTH the per-type parse and the setValue call in one
// try/catch and surface the Error.message as a themed inline error, keeping the
// input open so the user can fix it.
//
// Styling uses only the semantic Tailwind token utilities (never raw hex) so
// both the dark and spooky themes work automatically. A minimal, additive
// spooky-only hint on the open editor is gated to the spooky theme; full
// haunted-edit styling is Task 10.

import { useRef, useState } from 'react'
import type { Tag } from '../nbt/types'
import { TagType } from '../nbt/types'
import type { NbtPath, ScalarValue } from '../nbt/edit'
import { useNbtStore } from '../store/useNbtStore'
import type { Theme } from '../store/useThemeStore'
import { formatTagValue } from './tagDisplay'

/**
 * Derive the FULL editable seed string for a leaf tag.
 *
 * Unlike formatTagValue (which truncates typed arrays to a 3-element preview),
 * this returns the complete value so the input round-trips: Longs at full
 * bigint precision, typed arrays as the full comma-joined element list.
 * Compound/List are containers and never reach here.
 */
export function editableSeed(tag: Tag): string {
  switch (tag.type) {
    case TagType.Byte:
    case TagType.Short:
    case TagType.Int:
    case TagType.Float:
    case TagType.Double:
      return String(tag.value)
    case TagType.Long:
      return String(tag.value)
    case TagType.String:
      return tag.value
    case TagType.ByteArray:
    case TagType.IntArray:
      return Array.from(tag.value, (n) => String(n)).join(', ')
    case TagType.LongArray:
      return Array.from(tag.value, (n) => String(n)).join(', ')
    case TagType.Compound:
    case TagType.List:
      return ''
  }
}

/** Split a comma-separated array draft into trimmed, non-empty tokens. */
function arrayTokens(draft: string): string[] {
  const trimmed = draft.trim()
  if (trimmed === '') return []
  return trimmed.split(',').map((t) => t.trim())
}

/** Parse numeric array tokens, throwing a clear Error on any NaN token. */
function parseNumberTokens(tokens: string[], typeName: string): number[] {
  return tokens.map((token) => {
    const n = Number(token)
    if (Number.isNaN(n)) {
      throw new Error(`${typeName} element "${token}" is not a valid number`)
    }
    return n
  })
}

/**
 * Parse an editor draft into the correctly-typed ScalarValue for the tag.
 *
 * Numeric scalars use Number() (rejecting NaN/empty here; edit-core additionally
 * range/integer-checks Byte/Short/Int). Long uses BigInt() (NOT Number — BigInt
 * throws on an invalid/non-integer string, which is the desired error and
 * preserves precision above Number.MAX_SAFE_INTEGER). String is taken raw (no
 * trimming — strings may contain meaningful leading/trailing spaces). The typed
 * arrays parse a comma-separated list into exactly Int8Array/Int32Array/
 * BigInt64Array; an empty draft yields an empty typed array. Compound/List
 * never reach here.
 */
export function parseDraft(tag: Tag, draft: string): ScalarValue {
  switch (tag.type) {
    case TagType.Byte:
    case TagType.Short:
    case TagType.Int:
    case TagType.Float:
    case TagType.Double: {
      const trimmed = draft.trim()
      if (trimmed === '') {
        throw new Error('Value cannot be empty')
      }
      const n = Number(trimmed)
      if (Number.isNaN(n)) {
        throw new Error(`"${draft}" is not a valid number`)
      }
      return n
    }
    case TagType.Long: {
      const trimmed = draft.trim()
      if (trimmed === '') {
        throw new Error('Value cannot be empty')
      }
      // BigInt() throws on a non-integer / invalid string, which we surface.
      return BigInt(trimmed)
    }
    case TagType.String:
      return draft
    case TagType.ByteArray:
      return new Int8Array(parseNumberTokens(arrayTokens(draft), 'ByteArray'))
    case TagType.IntArray:
      return new Int32Array(parseNumberTokens(arrayTokens(draft), 'IntArray'))
    case TagType.LongArray:
      return new BigInt64Array(arrayTokens(draft).map((token) => BigInt(token)))
    case TagType.Compound:
    case TagType.List:
      // Unreachable: containers are never value-editable.
      throw new Error('Container tags are not value-editable')
  }
}

interface EditableLeafValueProps {
  tag: Tag
  path: NbtPath
  theme: Theme
  /** Human label (Compound key / List index / tag type) for accessible names. */
  label: string
}

/**
 * Click/keyboard-activatable leaf value that opens an inline editor committing
 * through the store. Resting state shows the compact formatted value; editing
 * state shows a seeded input plus a ✓ confirm affordance and an inline error.
 */
export function EditableLeafValue({ tag, path, theme, label }: EditableLeafValueProps) {
  const setValue = useNbtStore((s) => s.setValue)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Set on Escape so the input's blur handler does not then fire a commit.
  const cancelledRef = useRef(false)

  function beginEdit() {
    setDraft(editableSeed(tag))
    setError(null)
    cancelledRef.current = false
    setEditing(true)
  }

  function commit() {
    if (cancelledRef.current) return
    try {
      const value = parseDraft(tag, draft)
      setValue(path, value)
      setError(null)
      setEditing(false)
    } catch (err) {
      // Parse error or edit-core throw: keep the input open so the user can fix
      // it. The doc is untouched because setValueIn throws before mutating.
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function cancel() {
    cancelledRef.current = true
    setError(null)
    setEditing(false)
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={beginEdit}
        aria-label={`Edit value of ${label}`}
        className="rounded px-1 text-left text-fg hover:bg-panel focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
      >
        {formatTagValue(tag)}
      </button>
    )
  }

  // A minimal, additive spooky-only hint on the open editor (no animation, so
  // prefers-reduced-motion is respected). Task 10 owns the full haunted styling.
  const spookyHint = theme === 'spooky' ? ' text-accent' : ''

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <input
        type="text"
        autoFocus
        value={draft}
        aria-label={`Value for ${label}`}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            cancel()
          }
        }}
        onBlur={commit}
        className={`min-w-[8ch] rounded border bg-bg px-1 font-mono text-fg focus:outline-none focus-visible:ring-1 focus-visible:ring-accent${
          error !== null ? ' border-danger' : ' border-edge'
        }${spookyHint}`}
      />
      <button
        type="button"
        aria-label={`Confirm edit of ${label}`}
        // Commit before the input's blur-commit can fire; harmless if both run.
        onMouseDown={(e) => e.preventDefault()}
        onClick={commit}
        className="rounded border border-edge px-1 text-accent hover:bg-panel focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
      >
        ✓
      </button>
      {error !== null && (
        <span role="alert" className="text-danger">
          {error}
        </span>
      )}
    </span>
  )
}
