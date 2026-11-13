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

/**
 * Parse integer array tokens, throwing a clear Error on anything that is not a
 * whole number in [min, max]. Typed-array constructors silently wrap (200 in an
 * Int8Array becomes -56) and truncate (1.5 becomes 1), so validate first.
 */
function parseIntTokens(tokens: string[], typeName: string, min: number, max: number): number[] {
  return tokens.map((token) => {
    const n = token === '' ? NaN : Number(token)
    if (!Number.isInteger(n)) {
      throw new Error(`${typeName} element "${token}" is not a whole number`)
    }
    if (n < min || n > max) {
      throw new Error(`${typeName} element ${n} is out of range [${min}, ${max}]`)
    }
    return n
  })
}

const I64_MIN = -(2n ** 63n)
const I64_MAX = 2n ** 63n - 1n

/** Parse a Long literal (optional trailing L), rejecting values outside i64. */
function parseLong(token: string, what: string): bigint {
  const body = token.trim().replace(/[lL]$/, '')
  let value: bigint
  try {
    if (body === '') throw new Error()
    value = BigInt(body)
  } catch {
    throw new Error(`${what} "${token.trim()}" is not a whole number`)
  }
  if (value < I64_MIN || value > I64_MAX) {
    throw new Error(`${what} ${value} is out of range for a 64-bit Long`)
  }
  return value
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
      return parseLong(trimmed, 'Long value')
    }
    case TagType.String:
      return draft
    case TagType.ByteArray:
      return new Int8Array(parseIntTokens(arrayTokens(draft), 'ByteArray', -128, 127))
    case TagType.IntArray:
      return new Int32Array(parseIntTokens(arrayTokens(draft), 'IntArray', -2147483648, 2147483647))
    case TagType.LongArray:
      return new BigInt64Array(arrayTokens(draft).map((token) => parseLong(token, 'LongArray element')))
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
 * Build a globally-unique, stable accessible name for a leaf's controls.
 *
 * The human `label` (a Compound key / List index / tag type) is only locally
 * unique: `count` appears under every `compoundList` entry and List element
 * leaves fall back to numeric indices (`0`, `1`) that collide across every
 * List. Qualifying with the node's real NbtPath makes the name unique across
 * the whole tree, so screen readers and `getByRole({ name })` queries can tell
 * sibling-same-key leaves apart. The root leaf (empty path) keeps the bare
 * label. The path is joined with `/`, matching the tree's `data-nbt-path`
 * display form; identity/addressing still flows through the real `path` prop.
 */
function accessibleName(label: string, path: NbtPath): string {
  if (path.length === 0) return label
  return `${label} (${path.join('/')})`
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
  // Latched when the editor is closing (on Escape, or right after a successful
  // commit) so the blur the unmounting input fires cannot re-run commit():
  // Escape must not commit at all, and an Enter/✓ commit must write exactly
  // once. Reset in beginEdit so a closed field reopens cleanly. A legitimate
  // blur-commit (editing then clicking away) still runs because the flag is
  // only set once a commit/cancel has already decided the field is closing.
  const closingRef = useRef(false)

  // The accessible names are derived once per render from the path-qualified
  // label so the activation button, the input, and the ✓ confirm all agree.
  const name = accessibleName(label, path)

  function beginEdit() {
    setDraft(editableSeed(tag))
    setError(null)
    closingRef.current = false
    setEditing(true)
  }

  function commit() {
    // Guard the commit→blur path: once a commit (or cancel) has closed the
    // field, the unmount-triggered blur re-enters here and must be a no-op.
    if (closingRef.current) return
    try {
      const value = parseDraft(tag, draft)
      setValue(path, value)
      // Latch BEFORE closing so the blur that the unmounting input fires is
      // suppressed and the store is written exactly once.
      closingRef.current = true
      setError(null)
      setEditing(false)
    } catch (err) {
      // Parse error or edit-core throw: keep the input open so the user can fix
      // it. The doc is untouched because setValueIn throws before mutating.
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function cancel() {
    closingRef.current = true
    setError(null)
    setEditing(false)
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={beginEdit}
        aria-label={`Edit value of ${name}`}
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
        aria-label={`Value for ${name}`}
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
        aria-label={`Confirm edit of ${name}`}
        // preventDefault keeps focus on the input so its blur does not fire
        // before this click; the closingRef latch then makes any later blur a
        // no-op, so the ✓ commit writes the store exactly once.
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
