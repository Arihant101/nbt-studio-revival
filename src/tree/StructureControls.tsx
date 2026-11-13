// Structure-editing controls for the NBT tree (Task 7): rename a Compound key,
// delete any non-root node, add a child into a container, and reorder a child
// within its parent (move up / down). Every mutation commits through the
// existing useNbtStore actions (rename / remove / add / move) using the REAL
// NbtPath the tree threads to each node - no DOM re-parsing.
//
// The commit-through-store + try/catch + themed role="alert" text-danger
// inline error + path-qualified accessible names + closingRef blur latch all
// mirror the Task 6 EditableLeafValue pattern. edit-core is pure and THROWS
// before mutating, so a caught throw leaves the doc uncorrupted and we simply
// surface the Error.message and keep the control open.
//
// Styling uses only the semantic Tailwind token utilities (never raw hex) so
// both the dark and spooky themes work automatically. No animation is added,
// so prefers-reduced-motion is respected by construction. Type-picker option
// labels/sigils route through the tagDisplay helper, never ad-hoc ternaries.

import { useRef, useState } from 'react'
import type { Tag } from '../nbt/types'
import { TagType } from '../nbt/types'
import type { NbtPath } from '../nbt/edit'
import { useNbtStore } from '../store/useNbtStore'
import type { Theme } from '../store/useThemeStore'
import { sigil, tagTypeInfo } from './tagDisplay'

/**
 * Build a globally-unique, stable accessible name for a structure control.
 *
 * Mirrors EditableLeafValue.accessibleName: the bare `label` is only locally
 * unique (e.g. `count` repeats under every `compoundList` entry), so the real
 * NbtPath (joined with `/`, matching the tree's `data-nbt-path` display form)
 * qualifies it to a tree-wide-unique name. The root/empty path keeps the bare
 * label. Identity/addressing still flows through the real `path` prop.
 */
export function accessibleName(label: string, path: NbtPath): string {
  if (path.length === 0) return label
  return `${label} (${path.join('/')})`
}

/**
 * The 12 addable (non-End) tag types, in binary-id order. The add-child type
 * picker iterates exactly these; End is never addable (edit-core rejects it).
 */
export const ADDABLE_TAG_TYPES: readonly TagType[] = [
  TagType.Byte,
  TagType.Short,
  TagType.Int,
  TagType.Long,
  TagType.Float,
  TagType.Double,
  TagType.ByteArray,
  TagType.String,
  TagType.List,
  TagType.Compound,
  TagType.IntArray,
  TagType.LongArray,
]

/**
 * Build a valid default Tag for a chosen addable type. Numeric scalars default
 * to 0, Long to 0n, String to '', typed arrays to empty, List to an empty list
 * whose elementType is End (it adopts the first element's type on add), and
 * Compound to an empty Map. Never constructs an End tag.
 */
export function defaultTagForType(type: TagType): Tag {
  switch (type) {
    case TagType.Byte:
      return { type: TagType.Byte, value: 0 }
    case TagType.Short:
      return { type: TagType.Short, value: 0 }
    case TagType.Int:
      return { type: TagType.Int, value: 0 }
    case TagType.Float:
      return { type: TagType.Float, value: 0 }
    case TagType.Double:
      return { type: TagType.Double, value: 0 }
    case TagType.Long:
      return { type: TagType.Long, value: 0n }
    case TagType.String:
      return { type: TagType.String, value: '' }
    case TagType.ByteArray:
      return { type: TagType.ByteArray, value: new Int8Array(0) }
    case TagType.IntArray:
      return { type: TagType.IntArray, value: new Int32Array(0) }
    case TagType.LongArray:
      return { type: TagType.LongArray, value: new BigInt64Array(0) }
    case TagType.List:
      return { type: TagType.List, elementType: TagType.End, value: [] }
    case TagType.Compound:
      return { type: TagType.Compound, value: new Map() }
    case TagType.End:
      // Unreachable: End is never offered by ADDABLE_TAG_TYPES, but the switch
      // must be exhaustive for the TagType union.
      throw new Error('Cannot build a default End tag')
  }
}

// Shared Tailwind class recipes (semantic tokens only, focus-visible rings).
const BTN =
  'rounded border border-edge px-1 text-accent hover:bg-panel focus:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:cursor-not-allowed disabled:text-muted disabled:hover:bg-transparent'
const INPUT_BASE =
  'min-w-[8ch] rounded border bg-bg px-1 font-mono text-fg focus:outline-none focus-visible:ring-1 focus-visible:ring-accent'

interface RenameControlProps {
  /** Path of the parent Compound (this node's path minus its key). */
  parentPath: NbtPath
  /** The current key of this Compound entry. */
  oldKey: string
  /** This node's own path, used for a unique accessible name. */
  path: NbtPath
}

/**
 * Inline rename affordance for a Compound entry. Activation opens an input
 * seeded with the current key; Enter / the ✓ confirm / blur commits via
 * useNbtStore.rename, Escape cancels. A closingRef latch makes the blur that
 * follows a commit/cancel a no-op so rename runs at most once. A duplicate
 * newKey throw is surfaced as a themed inline error with the input kept open;
 * edit-core throws before mutating so the doc is unchanged.
 */
export function RenameControl({ parentPath, oldKey, path }: RenameControlProps) {
  const rename = useNbtStore((s) => s.rename)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const closingRef = useRef(false)

  const name = accessibleName(`Rename key ${oldKey}`, path)

  function beginEdit() {
    setDraft(oldKey)
    setError(null)
    closingRef.current = false
    setEditing(true)
  }

  function commit() {
    if (closingRef.current) return
    try {
      rename(parentPath, oldKey, draft)
      closingRef.current = true
      setError(null)
      setEditing(false)
    } catch (err) {
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
        aria-label={name}
        className={BTN}
      >
        ✎
      </button>
    )
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <input
        type="text"
        autoFocus
        value={draft}
        aria-label={`New key for ${accessibleName(oldKey, path)}`}
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
        className={`${INPUT_BASE} ${error !== null ? 'border-danger' : 'border-edge'}`}
      />
      <button
        type="button"
        aria-label={`Confirm rename of ${accessibleName(oldKey, path)}`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={commit}
        className={BTN}
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

interface DeleteControlProps {
  /** This node's own path (never the root []). */
  path: NbtPath
  /** Human label (Compound key / List index) for the accessible name. */
  label: string
}

/**
 * Delete affordance for any non-root node. Clicking commits via
 * useNbtStore.remove(path). removeIn only throws on removing the root (which we
 * never render this control for), but we keep the try/catch for safety and
 * surface any throw as a themed inline error. No undo here (Task 10 consumes
 * the store's RemovalRecord).
 */
export function DeleteControl({ path, label }: DeleteControlProps) {
  const remove = useNbtStore((s) => s.remove)
  const [error, setError] = useState<string | null>(null)

  const name = accessibleName(`Delete ${label}`, path)

  function onDelete() {
    try {
      remove(path)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button type="button" onClick={onDelete} aria-label={name} className={BTN}>
        ✕
      </button>
      {error !== null && (
        <span role="alert" className="text-danger">
          {error}
        </span>
      )}
    </span>
  )
}

interface MoveControlsProps {
  /** This child node's own path. Its last step is its index/key in the parent. */
  path: NbtPath
  /** The parent container tag, used to compute sibling order/bounds. */
  parent: Tag
  /** Human label (Compound key / List index) for the accessible names. */
  label: string
}

/**
 * Move up / move down affordances for a child within its parent container.
 *
 * List element at index i: up => move(path, i-1), down => move(path, i+1),
 * disabled at the ends. Compound entry: up/down swap position with the adjacent
 * key by computing the sibling order and calling move(path, targetIndex),
 * disabled at the ends. Any throw is caught and surfaced as a themed inline
 * error (edit-core throws before mutating, so the doc is unchanged).
 */
export function MoveControls({ path, parent, label }: MoveControlsProps) {
  const move = useNbtStore((s) => s.move)
  const [error, setError] = useState<string | null>(null)

  const parentPath = path.slice(0, -1)
  const last = path[path.length - 1]

  // Determine this child's ordinal position, the sibling count, and the sibling
  // keys (Compound) from the parent. Ends are disabled, so up/down never go out
  // of range.
  let index: number
  let count: number
  let siblingKeys: string[] | null = null
  if (parent.type === TagType.List) {
    index = typeof last === 'number' ? last : -1
    count = parent.value.length
  } else if (parent.type === TagType.Compound) {
    siblingKeys = [...parent.value.keys()]
    index = typeof last === 'string' ? siblingKeys.indexOf(last) : -1
    count = siblingKeys.length
  } else {
    index = -1
    count = 0
  }

  const canUp = index > 0
  const canDown = index >= 0 && index < count - 1

  // Path of a sibling at a given index within the same parent. For a List this
  // is the numeric index; for a Compound it is the key at that position.
  function siblingPath(i: number): NbtPath {
    if (siblingKeys !== null) return [...parentPath, siblingKeys[i]]
    return [...parentPath, i]
  }

  // Move this node up one slot: move it before the sibling now at index-1.
  function moveUp() {
    try {
      move(path, index - 1)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  // Move this node down one slot. A Compound's numeric target is measured
  // against the PRE-removal key array and a forward move internally decrements
  // it, so `move(path, index+1)` would be a no-op. Reframing "move X down" as
  // "move X's next sibling up to index" is a true swap that works uniformly for
  // both Lists and Compounds and never hits the forward-move decrement.
  function moveDown() {
    try {
      move(siblingPath(index + 1), index)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={moveUp}
        disabled={!canUp}
        aria-label={`${accessibleName(`Move ${label}`, path)} up`}
        className={BTN}
      >
        ↑
      </button>
      <button
        type="button"
        onClick={moveDown}
        disabled={!canDown}
        aria-label={`${accessibleName(`Move ${label}`, path)} down`}
        className={BTN}
      >
        ↓
      </button>
      {error !== null && (
        <span role="alert" className="text-danger">
          {error}
        </span>
      )}
    </span>
  )
}

interface AddChildControlProps {
  /** The container node's own path (the parentPath for the add). */
  path: NbtPath
  /** The container tag (Compound or List) a child is being added into. */
  container: Tag
  /** Human label for the container (its key / index / type) for a11y names. */
  label: string
  theme: Theme
}

/**
 * Add-child affordance for a container node. Opens a small form: a type picker
 * iterating the 12 non-End tag types (labels/sigils via tagDisplay) plus, for a
 * Compound, a required key input. Commits via useNbtStore.add with a valid
 * default tag; for a List the tag is appended (keyOrIndex omitted). Duplicate
 * key / list-type-mismatch / out-of-range throws are surfaced as a themed
 * inline error with the form kept open and the doc left unchanged.
 */
export function AddChildControl({ path, container, label, theme }: AddChildControlProps) {
  const add = useNbtStore((s) => s.add)
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<TagType>(TagType.Byte)
  const [keyDraft, setKeyDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const isCompound = container.type === TagType.Compound
  const name = accessibleName(`Add child to ${label}`, path)
  // NBT Lists hold a single type: once a List has elements, only that type can
  // be added, so offer just that instead of letting every other pick fail.
  const lockedType =
    container.type === TagType.List && container.value.length > 0 ? container.elementType : null
  const typeOptions = lockedType !== null ? [lockedType] : ADDABLE_TAG_TYPES

  function beginAdd() {
    setType(lockedType ?? TagType.Byte)
    setKeyDraft('')
    setError(null)
    setOpen(true)
  }

  function commit() {
    try {
      // Guard an empty/whitespace-only Compound key BEFORE touching the store
      // (edit-core only rejects duplicate keys, not empty ones). A `""`-keyed
      // entry has no label to re-open rename, so we reject it here and surface
      // the same themed inline error, mirroring EditableLeafValue's "Value
      // cannot be empty" guard. Lists have no key, so this applies only to the
      // Compound path.
      if (isCompound && keyDraft.trim() === '') {
        throw new Error('Key cannot be empty')
      }
      const tag = defaultTagForType(type)
      if (isCompound) {
        add(path, tag, keyDraft)
      } else {
        // List append: omit keyOrIndex so edit-core pushes to the end.
        add(path, tag)
      }
      setError(null)
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function cancel() {
    setError(null)
    setOpen(false)
  }

  if (!open) {
    return (
      <button type="button" onClick={beginAdd} aria-label={name} className={BTN}>
        ＋
      </button>
    )
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <select
        autoFocus
        value={type}
        aria-label={`New child type for ${accessibleName(label, path)}`}
        onChange={(e) => setType(Number(e.target.value) as TagType)}
        className={`rounded border border-edge bg-bg px-1 font-mono text-fg focus:outline-none focus-visible:ring-1 focus-visible:ring-accent`}
      >
        {typeOptions.map((t) => (
          <option key={t} value={t}>
            {sigil(t, theme)} {tagTypeInfo(t).label}
          </option>
        ))}
      </select>
      {isCompound && (
        <input
          type="text"
          value={keyDraft}
          aria-label={`New child key for ${accessibleName(label, path)}`}
          onChange={(e) => setKeyDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              cancel()
            }
          }}
          className={`${INPUT_BASE} ${error !== null ? 'border-danger' : 'border-edge'}`}
        />
      )}
      <button
        type="button"
        aria-label={`Confirm add child to ${accessibleName(label, path)}`}
        onClick={commit}
        className={BTN}
      >
        ✓
      </button>
      <button
        type="button"
        aria-label={`Cancel add child to ${accessibleName(label, path)}`}
        onClick={cancel}
        className={BTN}
      >
        ✕
      </button>
      {error !== null && (
        <span role="alert" className="text-danger">
          {error}
        </span>
      )}
    </span>
  )
}
