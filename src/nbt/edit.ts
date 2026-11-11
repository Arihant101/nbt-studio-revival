// Path-based, immutable edit core for the NBT tag model.
//
// Every function operates over the authoritative Tag model in ./types without
// forking it. Edits are immutable: new Map/array copies are built only along
// the mutated path (structural sharing elsewhere), and inputs are never
// mutated in place, so Zustand/React can detect changes by reference.

import type { NbtDocument, Tag } from './types'
import { TagType } from './types'

/**
 * Address of a tag relative to the root compound.
 *
 * A `string` step indexes into a Compound's `Map` by key; a `number` step
 * indexes into a List's `value` array by position. The empty path `[]`
 * addresses the root compound itself.
 */
export type NbtPath = readonly (string | number)[]

type CompoundTag = Extract<Tag, { type: typeof TagType.Compound }>
type ListTag = Extract<Tag, { type: typeof TagType.List }>

/** Scalar/leaf value shapes, discriminated by the tag's own type. */
type ScalarValue =
  | number // Byte/Short/Int/Float/Double
  | bigint // Long
  | string // String
  | Int8Array // ByteArray
  | Int32Array // IntArray
  | BigInt64Array // LongArray

/** What `removeIn` returns so a future Graveyard/undo can restore the tag. */
export interface RemovalRecord {
  /** The tag that was removed. */
  removed: Tag
  /** Path to the parent container the tag was removed from. */
  parentPath: NbtPath
  /** Compound key it lived under, when the parent is a Compound. */
  key?: string
  /**
   * The removed tag's ordinal position within its parent container: the List
   * array index, or (for a Compound) the key's insertion-order position. A
   * future Graveyard/undo needs this to restore a resurrected tag to its
   * original slot rather than appending it to the end.
   */
  index?: number
}

function isCompound(tag: Tag): tag is CompoundTag {
  return tag.type === TagType.Compound
}

function isList(tag: Tag): tag is ListTag {
  return tag.type === TagType.List
}

function describePath(path: NbtPath): string {
  return path.length === 0 ? '<root>' : path.map((s) => String(s)).join('/')
}

/** Inclusive integer bounds for the fixed-width integer tag types. */
const INTEGER_BOUNDS: Record<
  typeof TagType.Byte | typeof TagType.Short | typeof TagType.Int,
  { min: number; max: number; name: string }
> = {
  [TagType.Byte]: { min: -128, max: 127, name: 'Byte' },
  [TagType.Short]: { min: -32768, max: 32767, name: 'Short' },
  [TagType.Int]: { min: -2147483648, max: 2147483647, name: 'Int' },
}

/**
 * Validate that `value` is a whole number within the signed range of a
 * fixed-width integer tag. Setting an out-of-range or fractional value is
 * rejected here (rather than relying on silent truncation in binary.ts) so the
 * store/UI gets a clear error. Float/Double/Long are not range-checked: floats
 * are inherently approximate and Long is a bigint that binary.ts masks to 64
 * bits, so there is no JS-level narrowing to guard against.
 */
function assertIntegerInRange(
  type: typeof TagType.Byte | typeof TagType.Short | typeof TagType.Int,
  value: number,
  path: NbtPath,
): void {
  const { min, max, name } = INTEGER_BOUNDS[type]
  if (!Number.isInteger(value)) {
    throw new Error(`${name} tag at ${describePath(path)} expects an integer value, got ${value}`)
  }
  if (value < min || value > max) {
    throw new Error(
      `${name} tag at ${describePath(path)} value ${value} is out of range [${min}, ${max}]`,
    )
  }
}

/** Resolve the tag at `path`, or `undefined` if any step is missing. */
export function getIn(root: Tag, path: NbtPath): Tag | undefined {
  let current: Tag | undefined = root
  for (const step of path) {
    if (current === undefined) return undefined
    if (typeof step === 'string') {
      if (!isCompound(current)) return undefined
      current = current.value.get(step)
    } else {
      if (!isList(current)) return undefined
      current = current.value[step]
    }
  }
  return current
}

/** Resolve the tag at `path`, throwing a clear error when it does not exist. */
function requireIn(root: Tag, path: NbtPath): Tag {
  const tag = getIn(root, path)
  if (tag === undefined) {
    throw new Error(`No tag at path ${describePath(path)}`)
  }
  return tag
}

/**
 * Rebuild the container chain down to `path`, applying `update` to the tag at
 * `path` and copying every container along the way. `update` receives the
 * current tag at `path` and returns its replacement.
 */
function updateAt(root: Tag, path: NbtPath, update: (tag: Tag) => Tag): Tag {
  if (path.length === 0) {
    return update(root)
  }
  const [step, ...rest] = path
  const restPath = rest as NbtPath

  if (typeof step === 'string') {
    if (!isCompound(root)) {
      throw new Error(`Expected a Compound at ${describePath([])} to index key "${step}"`)
    }
    const child = root.value.get(step)
    if (child === undefined) {
      throw new Error(`No key "${step}" in Compound`)
    }
    const newChild = updateAt(child, restPath, update)
    const newMap = new Map(root.value)
    newMap.set(step, newChild)
    return { type: TagType.Compound, value: newMap }
  }

  if (!isList(root)) {
    throw new Error(`Expected a List to index position ${step}`)
  }
  const child = root.value[step]
  if (child === undefined) {
    throw new Error(`No index ${step} in List`)
  }
  const newChild = updateAt(child, restPath, update)
  const newArr = root.value.slice()
  newArr[step] = newChild
  return { type: TagType.List, elementType: root.elementType, value: newArr }
}

/**
 * Replace the scalar/leaf value of the tag at `path`, keeping its tag type.
 * Rejects type-mismatched values and non-leaf (Compound/List) targets.
 */
export function setValueIn(root: Tag, path: NbtPath, value: ScalarValue): Tag {
  return updateAt(root, path, (tag) => {
    switch (tag.type) {
      case TagType.Byte:
      case TagType.Short:
      case TagType.Int:
        if (typeof value !== 'number') {
          throw new Error(`Tag at ${describePath(path)} expects a number value`)
        }
        assertIntegerInRange(tag.type, value, path)
        return { type: tag.type, value }
      case TagType.Float:
      case TagType.Double:
        if (typeof value !== 'number') {
          throw new Error(`Tag at ${describePath(path)} expects a number value`)
        }
        return { type: tag.type, value }
      case TagType.Long:
        if (typeof value !== 'bigint') {
          throw new Error(`Long tag at ${describePath(path)} expects a bigint value`)
        }
        return { type: tag.type, value }
      case TagType.String:
        if (typeof value !== 'string') {
          throw new Error(`String tag at ${describePath(path)} expects a string value`)
        }
        return { type: tag.type, value }
      case TagType.ByteArray:
        if (!(value instanceof Int8Array)) {
          throw new Error(`ByteArray tag at ${describePath(path)} expects an Int8Array value`)
        }
        return { type: tag.type, value }
      case TagType.IntArray:
        if (!(value instanceof Int32Array)) {
          throw new Error(`IntArray tag at ${describePath(path)} expects an Int32Array value`)
        }
        return { type: tag.type, value }
      case TagType.LongArray:
        if (!(value instanceof BigInt64Array)) {
          throw new Error(`LongArray tag at ${describePath(path)} expects a BigInt64Array value`)
        }
        return { type: tag.type, value }
      default:
        throw new Error(`Cannot setValue on a ${tag.type === TagType.Compound ? 'Compound' : 'List'} tag at ${describePath(path)}`)
    }
  })
}

/**
 * Rename a key within the Compound at `parentPath`. Renaming to the same key is
 * a no-op; renaming to a key that already exists is rejected to avoid silent
 * data loss. Key insertion order is preserved (the renamed entry keeps its
 * position).
 */
export function renameIn(root: Tag, parentPath: NbtPath, oldKey: string, newKey: string): Tag {
  return updateAt(root, parentPath, (tag) => {
    if (!isCompound(tag)) {
      throw new Error(`Cannot rename within a non-Compound at ${describePath(parentPath)}`)
    }
    if (!tag.value.has(oldKey)) {
      throw new Error(`No key "${oldKey}" in Compound at ${describePath(parentPath)}`)
    }
    if (oldKey === newKey) {
      return tag
    }
    if (tag.value.has(newKey)) {
      throw new Error(`Key "${newKey}" already exists in Compound at ${describePath(parentPath)}`)
    }
    const newMap = new Map<string, Tag>()
    for (const [k, v] of tag.value) {
      newMap.set(k === oldKey ? newKey : k, v)
    }
    return { type: TagType.Compound, value: newMap }
  })
}

/**
 * Insert `tag` into the container at `parentPath`.
 *
 * For a Compound parent, `keyOrIndex` must be the string key (required). For a
 * List parent, `keyOrIndex` is an optional insertion index; when omitted the
 * tag is appended. List homogeneity is enforced: inserting into an empty list
 * sets its `elementType`; inserting into a non-empty list requires a matching
 * type. The End tag type cannot be added as a value.
 */
export function addIn(
  root: Tag,
  parentPath: NbtPath,
  tag: Tag,
  keyOrIndex?: string | number,
): Tag {
  // `Tag` never models End, but a caller may hand-build one via a cast; guard
  // defensively by comparing the raw numeric id.
  if ((tag.type as number) === TagType.End) {
    throw new Error('Cannot add an End tag')
  }
  return updateAt(root, parentPath, (parent) => {
    if (isCompound(parent)) {
      if (typeof keyOrIndex !== 'string') {
        throw new Error(`Adding to a Compound at ${describePath(parentPath)} requires a string key`)
      }
      if (parent.value.has(keyOrIndex)) {
        throw new Error(`Key "${keyOrIndex}" already exists in Compound at ${describePath(parentPath)}`)
      }
      const newMap = new Map(parent.value)
      newMap.set(keyOrIndex, tag)
      return { type: TagType.Compound, value: newMap }
    }
    if (isList(parent)) {
      if (parent.value.length > 0 && tag.type !== parent.elementType) {
        throw new Error(
          `Cannot add a tag of type ${tag.type} to a List at ${describePath(parentPath)} whose elementType is ${parent.elementType}`,
        )
      }
      const newArr = parent.value.slice()
      if (keyOrIndex === undefined) {
        newArr.push(tag)
      } else {
        if (typeof keyOrIndex !== 'number') {
          throw new Error(`Inserting into a List at ${describePath(parentPath)} requires a numeric index`)
        }
        if (keyOrIndex < 0 || keyOrIndex > newArr.length) {
          throw new Error(`Index ${keyOrIndex} out of range for List at ${describePath(parentPath)}`)
        }
        newArr.splice(keyOrIndex, 0, tag)
      }
      const elementType = parent.value.length === 0 ? tag.type : parent.elementType
      return { type: TagType.List, elementType, value: newArr }
    }
    throw new Error(`Cannot add into a non-container tag at ${describePath(parentPath)}`)
  })
}

/**
 * Remove the tag at `path` from its parent Compound (by key) or List (by
 * index). Returns the new tree plus a {@link RemovalRecord}. A List that
 * becomes empty resets its `elementType` to {@link TagType.End}.
 */
export function removeIn(root: Tag, path: NbtPath): { root: Tag; record: RemovalRecord } {
  if (path.length === 0) {
    throw new Error('Cannot remove the root tag')
  }
  const parentPath = path.slice(0, -1) as NbtPath
  const last = path[path.length - 1]
  const removed = requireIn(root, path)
  const parent = requireIn(root, parentPath)

  // Capture the ordinal position before removal so a Graveyard restore can put
  // the tag back in its original slot. For a Compound this is the key's
  // insertion-order position; for a List it is the array index.
  let ordinal: number | undefined
  if (typeof last === 'string') {
    if (isCompound(parent)) {
      ordinal = [...parent.value.keys()].indexOf(last)
    }
  } else {
    ordinal = last
  }

  const newRoot = updateAt(root, parentPath, (p) => {
    if (typeof last === 'string') {
      if (!isCompound(p)) {
        throw new Error(`Expected a Compound at ${describePath(parentPath)} to remove key "${last}"`)
      }
      const newMap = new Map(p.value)
      newMap.delete(last)
      return { type: TagType.Compound, value: newMap }
    }
    if (!isList(p)) {
      throw new Error(`Expected a List at ${describePath(parentPath)} to remove index ${last}`)
    }
    const newArr = p.value.slice()
    newArr.splice(last, 1)
    const elementType = newArr.length === 0 ? TagType.End : p.elementType
    return { type: TagType.List, elementType, value: newArr }
  })

  const record: RemovalRecord =
    typeof last === 'string'
      ? { removed, parentPath, key: last, index: ordinal }
      : { removed, parentPath, index: ordinal }
  return { root: newRoot, record }
}

/**
 * Move/reorder the tag at `path` within its parent.
 *
 * Within a List parent, `to` must be the destination numeric index. Within a
 * Compound parent, `to` is the destination key position: either a numeric
 * target index or an existing key before which the moved entry is placed.
 */
export function moveIn(root: Tag, path: NbtPath, to: number | string): Tag {
  if (path.length === 0) {
    throw new Error('Cannot move the root tag')
  }
  const parentPath = path.slice(0, -1) as NbtPath
  const last = path[path.length - 1]

  return updateAt(root, parentPath, (parent) => {
    if (typeof last === 'number') {
      if (!isList(parent)) {
        throw new Error(`Expected a List at ${describePath(parentPath)} to move index ${last}`)
      }
      if (typeof to !== 'number') {
        throw new Error(`Moving within a List at ${describePath(parentPath)} requires a numeric target index`)
      }
      const len = parent.value.length
      if (last < 0 || last >= len) {
        throw new Error(`Index ${last} out of range for List at ${describePath(parentPath)}`)
      }
      if (to < 0 || to >= len) {
        throw new Error(`Target index ${to} out of range for List at ${describePath(parentPath)}`)
      }
      const newArr = parent.value.slice()
      const [moved] = newArr.splice(last, 1)
      newArr.splice(to, 0, moved)
      return { type: TagType.List, elementType: parent.elementType, value: newArr }
    }

    if (!isCompound(parent)) {
      throw new Error(`Expected a Compound at ${describePath(parentPath)} to move key "${last}"`)
    }
    if (!parent.value.has(last)) {
      throw new Error(`No key "${last}" in Compound at ${describePath(parentPath)}`)
    }
    const keys = [...parent.value.keys()]
    const fromIndex = keys.indexOf(last)
    let toIndex: number
    if (typeof to === 'number') {
      toIndex = to
    } else {
      toIndex = keys.indexOf(to)
      if (toIndex === -1) {
        throw new Error(`No key "${to}" in Compound at ${describePath(parentPath)}`)
      }
    }
    if (toIndex < 0 || toIndex >= keys.length) {
      throw new Error(`Target position ${toIndex} out of range for Compound at ${describePath(parentPath)}`)
    }
    // `toIndex` is measured against the pre-removal key array. Removing the
    // source first shifts every later position down by one, so a forward move
    // (source before target) must decrement `toIndex` to still land the moved
    // entry at the target's current slot (i.e. before the target key). Without
    // this the entry would land one slot too far, after the target.
    const insertIndex = fromIndex < toIndex ? toIndex - 1 : toIndex
    keys.splice(fromIndex, 1)
    keys.splice(insertIndex, 0, last)
    const newMap = new Map<string, Tag>()
    for (const k of keys) {
      newMap.set(k, parent.value.get(k)!)
    }
    return { type: TagType.Compound, value: newMap }
  })
}

// --- Thin NbtDocument wrappers -------------------------------------------
// Each returns a NEW NbtDocument with a NEW root reference so React/Zustand
// re-render. The root tag is always a Compound.

function withRoot(doc: NbtDocument, newRoot: Tag): NbtDocument {
  if (newRoot.type !== TagType.Compound) {
    throw new Error('Edit produced a non-Compound root')
  }
  return { ...doc, root: newRoot }
}

export function setValue(doc: NbtDocument, path: NbtPath, value: ScalarValue): NbtDocument {
  return withRoot(doc, setValueIn(doc.root, path, value))
}

export function rename(doc: NbtDocument, parentPath: NbtPath, oldKey: string, newKey: string): NbtDocument {
  return withRoot(doc, renameIn(doc.root, parentPath, oldKey, newKey))
}

export function add(doc: NbtDocument, parentPath: NbtPath, tag: Tag, keyOrIndex?: string | number): NbtDocument {
  return withRoot(doc, addIn(doc.root, parentPath, tag, keyOrIndex))
}

export function remove(doc: NbtDocument, path: NbtPath): { doc: NbtDocument; record: RemovalRecord } {
  const { root, record } = removeIn(doc.root, path)
  return { doc: withRoot(doc, root), record }
}

export function move(doc: NbtDocument, path: NbtPath, to: number | string): NbtDocument {
  return withRoot(doc, moveIn(doc.root, path, to))
}

export type { ScalarValue }
