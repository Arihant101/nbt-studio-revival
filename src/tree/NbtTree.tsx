// Read-only collapsible tree view for an NBT document.
//
// Renders the root compound and recurses through every tag type. Compound and
// List tags are collapsible; leaf tags show their key/index, type sigil+label,
// and formatted value. Every node carries its NbtPath (root = [], a Compound
// child extends with the string key, a List element extends with the numeric
// index) exposed via a data-nbt-path attribute so later tasks can attach
// store.setValue(path,...)/rename/add/remove/move onto nodes.
//
// All presentation (sigils/labels/colors/value formatting) routes through the
// FEAT-001 tagDisplay helper; no ad-hoc theme ternaries live here. Styling uses
// only semantic Tailwind tokens so both themes work automatically.
//
// Keyboard navigation (Task 11): the tree implements a pragmatic subset of the
// WAI-ARIA tree pattern. The outer <ul> is role="tree"; each node <li> is
// role="treeitem" (aria-expanded on containers, aria-level = depth+1); child
// lists are role="group". Exactly one treeitem row is in the tab order at a
// time (roving tabindex) via NbtTree-owned `focusedId` state. The MODEL: a
// single onKeyDown handler is attached to the outer <ul> (events bubble up from
// the focused row). It computes the flat, in-DOM-order list of currently
// VISIBLE node ids (respecting the effective expansion set, incl. séance search
// ancestors) and resolves ArrowUp/Down/Home/End against it, moving real DOM
// focus to the target row's focusable element through a ref map. ArrowRight/
// ArrowLeft expand/collapse (reusing the mouse `toggle(id)` path) or step to
// child/parent; Enter/Space toggle a container. The handler is GUARDED to
// ignore events originating from inline <input>/<select>/<textarea> editors
// (EditableLeafValue / RenameControl / AddChildControl) so their own key
// handling (Enter commits, Escape cancels, arrows move the caret) is untouched.

import { useCallback, useMemo, useRef, useState } from 'react'
import type { NbtDocument, Tag } from '../nbt/types'
import { TagType } from '../nbt/types'
import type { NbtPath } from '../nbt/edit'
import { useNbtStore } from '../store/useNbtStore'
import { useThemeStore, type Theme } from '../store/useThemeStore'
import { childCount, hauntedMarker, tagDisplay } from './tagDisplay'
import { computeMatches } from './searchMatch'
import { EditableLeafValue } from './EditableLeafValue'
import {
  AddChildControl,
  DeleteControl,
  MoveControls,
  RenameControl,
} from './StructureControls'

/**
 * Injective, reversible serialization of an NbtPath.
 *
 * Used for the React key, the expand-Set membership key, and the
 * `data-nbt-path-json` DOM attribute so each rendered node stays
 * unambiguously addressable by its real NbtPath. Unlike a `/`-joined
 * string this preserves (a) the string-vs-number distinction between a
 * Compound key and a List index and (b) keys that themselves contain the
 * display separator, so two distinct nodes can never collide to the same
 * key. JSON of the path array round-trips straight back into an NbtPath.
 */
function pathId(path: NbtPath): string {
  return JSON.stringify(path)
}

/** Parse a `data-nbt-path-json` value back into a real NbtPath. */
export function parsePathId(id: string): NbtPath {
  return JSON.parse(id) as NbtPath
}

/**
 * Human-readable display form used for `data-nbt-path`. This is lossy by
 * design (steps joined with `/`, like edit.ts describePath) and is NOT used
 * for identity or addressing - use pathId/data-nbt-path-json for that.
 */
function pathDisplay(path: NbtPath): string {
  return path.join('/')
}

function isContainer(tag: Tag): boolean {
  return childCount(tag) !== null
}

// Themed copy for the placeholder row shown inside an EXPANDED container that
// has zero children, so an empty Compound/List reads as intentionally empty
// rather than as a blank list. Routed through a Record<Theme,string> copy map
// (never ad-hoc ternaries), mirroring the App.tsx copy-map pattern. Rendered
// with the text-muted semantic token; it is presentational chrome, NOT a
// treeitem, so it never enters flattenVisible / keyboard navigation.
const emptyContainerCopy: Record<Theme, string> = {
  dark: '(empty)',
  spooky: '(empty crypt)',
}

/**
 * How many children an expanded container renders at first. Region/structure
 * files can hold Lists with tens of thousands of entries; rendering them all
 * at once freezes the tab, so larger containers page in with "Show more".
 */
export const CHILD_PAGE_SIZE = 200

/** A single entry in the flattened, in-DOM-order list of visible treeitems. */
interface FlatNode {
  /** The node's path id (data-nbt-path-json / expansion-Set key). */
  id: string
  /** The node's real NbtPath. */
  path: NbtPath
  /** Depth from the root (root = 0). */
  depth: number
  /** Whether this node is a container (Compound/List). */
  container: boolean
  /** Whether this container is effectively expanded (false for leaves). */
  expanded: boolean
}

/**
 * Walk the document producing the flat, in-DOM-order list of currently VISIBLE
 * node ids. "Visible" means every ancestor is effectively expanded. The
 * `isExpanded` predicate encapsulates the effective expansion set (user
 * expansion unioned with séance-search ancestors) so navigation traverses
 * exactly what is on screen. This mirrors the render recursion order so the
 * list and the DOM stay in lockstep.
 */
function flattenVisible(
  root: Tag,
  rootPath: NbtPath,
  isExpanded: (id: string) => boolean,
  childLimit: (id: string) => number,
): FlatNode[] {
  const out: FlatNode[] = []
  const walk = (tag: Tag, path: NbtPath, depth: number) => {
    const id = pathId(path)
    const container = isContainer(tag)
    const expanded = container && isExpanded(id)
    out.push({ id, path, depth, container, expanded })
    if (!expanded) return
    const limit = childLimit(id)
    if (tag.type === TagType.Compound) {
      let i = 0
      for (const [childKey, childTag] of tag.value.entries()) {
        if (i++ >= limit) break
        walk(childTag, [...path, childKey], depth + 1)
      }
    } else if (tag.type === TagType.List) {
      const n = Math.min(tag.value.length, limit)
      for (let index = 0; index < n; index++) {
        walk(tag.value[index]!, [...path, index], depth + 1)
      }
    }
  }
  walk(root, rootPath, 0)
  return out
}

/** Shared per-tree context passed to every node for roving focus + keydown. */
interface TreeNav {
  /** Path id of the treeitem that currently owns the tab stop (tabIndex 0). */
  focusedId: string
  /** Register/unregister a row's focusable element for DOM focus moves. */
  registerRow: (id: string, el: HTMLElement | null) => void
  /** Tree-level keydown handler (attached to the outer <ul>). */
  onKeyDown: (e: React.KeyboardEvent) => void
  /** Mark a row as the keyboard-focused one when it receives DOM focus. */
  onRowFocus: (id: string) => void
  /** How many children of container `id` are currently rendered. */
  childLimit: (id: string) => number
  /** Render the next page of children for container `id`. */
  showMore: (id: string) => void
}

interface TreeNodeProps {
  /** Label shown for this node: a Compound child key or a List index. */
  nodeKey: string | number | null
  tag: Tag
  path: NbtPath
  depth: number
  theme: Theme
  expanded: Set<string>
  toggle: (key: string) => void
  /** The parent container tag, or null for the root node. */
  parent: Tag | null
  /**
   * JSON path ids of tags edited/added/renamed/moved since load or last export
   * (the store's `dirty` set). A node is "haunted"/unsaved when its own id is a
   * member. Passed by reference so every node shares one lookup.
   */
  dirty: Set<string>
  /**
   * Whether a séance search is active (non-empty query). When false all
   * search highlight/dim styling is off and the tree behaves normally.
   */
  searchActive: boolean
  /** JSON path ids of nodes matching the active search query. */
  matches: Set<string>
  /** JSON path ids of ancestors of matches (force-expanded while searching). */
  ancestors: Set<string>
  /** Roving-focus + keyboard navigation context shared across the tree. */
  nav: TreeNav
}

function TreeNode({
  nodeKey,
  tag,
  path,
  depth,
  theme,
  expanded,
  toggle,
  parent,
  dirty,
  searchActive,
  matches,
  ancestors,
  nav,
}: TreeNodeProps) {
  const display = tagDisplay(tag.type, theme)
  const container = isContainer(tag)
  // Identity/addressing uses the injective JSON form; the slash-joined form is
  // display-only (data-nbt-path) for human-readability.
  const id = pathId(path)
  // This node is "haunted" (unsaved) when its path id is in the dirty set.
  const haunted = dirty.has(id)
  const marker = hauntedMarker(theme)
  const displayPath = pathDisplay(path)
  const count = childCount(tag)

  // Séance search state for this node. A match gets a STATIC highlight (accent
  // color + ring) plus a .nbt-lantern class whose glow animates only under
  // prefers-reduced-motion: no-preference. A non-match that is also not an
  // ancestor of a match is dimmed. While searching, ancestors of matches are
  // force-expanded via an EFFECTIVE expansion set (userExpanded ∪ ancestors)
  // so matches are visible without mutating the user's manual expansion.
  const isMatch = searchActive && matches.has(id)
  const isAncestor = searchActive && ancestors.has(id)
  const isDimmed = searchActive && !isMatch && !isAncestor
  const isExpanded = searchActive ? expanded.has(id) || ancestors.has(id) : expanded.has(id)

  const keyLabel = nodeKey === null ? null : String(nodeKey)
  // Accessible name for the editable leaf control: the Compound key / List
  // index when present, otherwise the tag type label.
  const leafLabel = keyLabel ?? display.label

  // Structure-edit affordances (Task 7). The root ([]) is never
  // renamable/removable/movable; a Compound child (string nodeKey) may be
  // renamed; every non-root node may be removed and moved within its parent;
  // every container may receive a new child. The commit path is the store.
  const isRoot = path.length === 0
  const isCompoundChild = typeof nodeKey === 'string' && parent?.type === TagType.Compound
  const controlLabel = keyLabel ?? display.label

  // Roving tabindex: exactly one treeitem row is tabbable at a time. The row
  // owning the keyboard focus gets tabIndex 0; all others get -1. A ref
  // callback registers the focusable row element so the tree-level keydown
  // handler can move real DOM focus to it on Arrow/Home/End navigation.
  const isFocusTarget = nav.focusedId === id
  const rowTabIndex = isFocusTarget ? 0 : -1
  const registerRef = (el: HTMLElement | null) => nav.registerRow(id, el)
  const handleRowFocus = () => nav.onRowFocus(id)

  const rowContent = (
    <span className="flex items-center gap-2">
      <span className={display.color} aria-hidden="true">
        {display.sigil}
      </span>
      <span className="text-muted">{display.label}</span>
      {keyLabel !== null && <span className="text-accent">{keyLabel}</span>}
      {haunted && (
        <span className="nbt-haunted text-accent" title={marker.label}>
          <span aria-hidden="true">{marker.glyph}</span>
          <span className="sr-only">{marker.label}</span>
        </span>
      )}
      {container ? (
        <span className="text-muted">({count})</span>
      ) : (
        <EditableLeafValue tag={tag} path={path} theme={theme} label={leafLabel} />
      )}
    </span>
  )

  // The structure controls live in their own span, outside the container
  // toggle <button> (buttons cannot nest), so every node row can host them.
  const controls = (
    <span className="ml-2 inline-flex flex-wrap items-center gap-1">
      {isCompoundChild && (
        <RenameControl parentPath={path.slice(0, -1)} oldKey={String(nodeKey)} path={path} />
      )}
      {!isRoot && parent !== null && (
        <MoveControls path={path} parent={parent} label={controlLabel} />
      )}
      {container && (
        <AddChildControl path={path} container={tag} label={controlLabel} theme={theme} />
      )}
      {!isRoot && <DeleteControl path={path} label={controlLabel} />}
    </span>
  )

  // Row styling for the active séance search. Matches carry a static accent
  // highlight (color + ring, perceivable with reduced motion) plus the
  // .nbt-lantern glow class; non-matches that are not ancestors are dimmed.
  // Both use semantic tokens only. The `data-search-match` / `data-search-dim`
  // attributes make the state assertable in tests without relying on classes.
  const rowClass = [
    'flex items-center gap-2 rounded px-1 py-0.5',
    isMatch ? 'nbt-lantern text-accent ring-1 ring-accent' : '',
    isDimmed ? 'text-muted opacity-50' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <li
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={container ? isExpanded : undefined}
      data-nbt-path={displayPath}
      data-nbt-path-json={id}
      data-search-match={isMatch ? 'true' : undefined}
      data-search-dim={isDimmed ? 'true' : undefined}
      style={{ paddingLeft: `${depth * 1}rem` }}
    >
      {container ? (
        <div className={rowClass}>
          {/* The container toggle is the roving-focus element for this row: it
              is the first button (existing tests rely on that) and carries the
              roving tabIndex + a focus-visible ring so keyboard focus shows. */}
          <button
            type="button"
            ref={registerRef}
            tabIndex={rowTabIndex}
            onFocus={handleRowFocus}
            onClick={() => toggle(id)}
            aria-expanded={isExpanded}
            className="flex items-center gap-2 rounded text-left hover:bg-panel focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            <span
              className="nbt-caret text-muted"
              data-expanded={isExpanded}
              aria-hidden="true"
            >
              ▸
            </span>
            {rowContent}
          </button>
          {controls}
        </div>
      ) : (
        <div
          ref={registerRef}
          tabIndex={rowTabIndex}
          onFocus={handleRowFocus}
          className={`${rowClass} focus:outline-none focus-visible:ring-1 focus-visible:ring-accent`}
        >
          <span className="inline-block w-[1ch]" aria-hidden="true" />
          {rowContent}
          {controls}
        </div>
      )}
      {container && isExpanded && (
        <ul role="group" className="border-l border-edge">
          {count === 0 ? (
            // Empty expanded container: render a muted, non-navigable
            // placeholder row (presentation only, not role=treeitem) so the
            // container does not render as a blank <ul>. Kept out of
            // flattenVisible, so keyboard navigation is unaffected.
            <li role="presentation" className="px-1 py-0.5" style={{ paddingLeft: `${(depth + 1) * 1}rem` }}>
              <span className="text-muted">{emptyContainerCopy[theme]}</span>
            </li>
          ) : (
            renderChildren(tag, path, depth + 1, theme, expanded, toggle, dirty, searchActive, matches, ancestors, nav)
          )}
        </ul>
      )}
    </li>
  )
}

const showMoreCopy: Record<Theme, (next: number, hidden: number) => string> = {
  dark: (next, hidden) => `Show ${next} more (${hidden} hidden)`,
  spooky: (next, hidden) => `Summon ${next} more (${hidden} still buried)`,
}

function renderChildren(
  tag: Tag,
  path: NbtPath,
  depth: number,
  theme: Theme,
  expanded: Set<string>,
  toggle: (key: string) => void,
  dirty: Set<string>,
  searchActive: boolean,
  matches: Set<string>,
  ancestors: Set<string>,
  nav: TreeNav,
) {
  const id = pathId(path)
  const limit = nav.childLimit(id)
  const total = tag.type === TagType.Compound ? tag.value.size : tag.type === TagType.List ? tag.value.length : 0
  const hidden = total - limit
  const more =
    hidden > 0 ? (
      <li key="__more" role="none" className="px-1 py-0.5" style={{ paddingLeft: `${depth * 1}rem` }}>
        <button
          type="button"
          onClick={() => nav.showMore(id)}
          className="rounded border border-edge px-2 text-accent hover:bg-panel focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        >
          {showMoreCopy[theme](Math.min(CHILD_PAGE_SIZE, hidden), hidden)}
        </button>
      </li>
    ) : null
  return [...renderChildRows(tag, path, depth, theme, expanded, toggle, dirty, searchActive, matches, ancestors, nav, limit), more]
}

function renderChildRows(
  tag: Tag,
  path: NbtPath,
  depth: number,
  theme: Theme,
  expanded: Set<string>,
  toggle: (key: string) => void,
  dirty: Set<string>,
  searchActive: boolean,
  matches: Set<string>,
  ancestors: Set<string>,
  nav: TreeNav,
  limit: number,
) {
  if (tag.type === TagType.Compound) {
    const entries = [...tag.value.entries()].slice(0, limit)
    return entries.map(([childKey, childTag]) => {
      const childPath: NbtPath = [...path, childKey]
      return (
        <TreeNode
          key={pathId(childPath)}
          nodeKey={childKey}
          tag={childTag}
          path={childPath}
          depth={depth}
          theme={theme}
          expanded={expanded}
          toggle={toggle}
          parent={tag}
          dirty={dirty}
          searchActive={searchActive}
          matches={matches}
          ancestors={ancestors}
          nav={nav}
        />
      )
    })
  }
  if (tag.type === TagType.List) {
    return tag.value.slice(0, limit).map((childTag, index) => {
      const childPath: NbtPath = [...path, index]
      return (
        <TreeNode
          key={pathId(childPath)}
          nodeKey={index}
          tag={childTag}
          path={childPath}
          depth={depth}
          theme={theme}
          expanded={expanded}
          toggle={toggle}
          parent={tag}
          dirty={dirty}
          searchActive={searchActive}
          matches={matches}
          ancestors={ancestors}
          nav={nav}
        />
      )
    })
  }
  return []
}

export interface NbtTreeProps {
  /** The document to render. Its root compound is shown first. */
  doc: NbtDocument
  /**
   * Séance search query (view-local, owned by App). Normalized here; when it
   * is non-empty the tree highlights matches, dims non-matches, and
   * force-expands ancestors of matches without mutating the user's manual
   * expansion. Defaults to '' (search inactive).
   */
  query?: string
}

/** Collapsible, read-only tree view of an NBT document. */
export function NbtTree({ doc, query = '' }: NbtTreeProps) {
  const theme = useThemeStore((s) => s.theme)
  // Haunted/unsaved path ids from the store; a node marks itself when its own
  // id is a member. Read once here and threaded down so every node shares one
  // lookup rather than each subscribing.
  const dirty = useNbtStore((s) => s.dirty)
  // Root ([]) starts expanded; deeper containers start collapsed.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([pathId([])]))
  // Roving tabindex: the path id of the treeitem row that currently owns the
  // single tab stop. Defaults to the root so a Tab into the tree lands there.
  const [focusedId, setFocusedId] = useState<string>(() => pathId([]))
  // id -> focusable row element, so the keydown handler can move DOM focus.
  const rowRefs = useRef(new Map<string, HTMLElement>())
  // Per-container render limits for paging large containers (see CHILD_PAGE_SIZE).
  const [limits, setLimits] = useState<Map<string, number>>(() => new Map())
  const childLimit = useCallback((id: string) => limits.get(id) ?? CHILD_PAGE_SIZE, [limits])
  const showMore = useCallback((id: string) => {
    setLimits((prev) => {
      const next = new Map(prev)
      next.set(id, (prev.get(id) ?? CHILD_PAGE_SIZE) + CHILD_PAGE_SIZE)
      return next
    })
  }, [])

  const toggle = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  const rootPath: NbtPath = []

  // Séance search: normalize the query and compute match/ancestor id sets once
  // per render (pure walk of the doc). An empty query yields empty sets, so the
  // tree renders exactly as before. Memoized on the doc + normalized query so a
  // keystroke only recomputes when the effective query changes.
  const normalizedQuery = query.trim().toLowerCase()
  const searchActive = normalizedQuery !== ''
  const { matches, ancestors } = useMemo(
    () => computeMatches(doc.root, normalizedQuery),
    [doc, normalizedQuery],
  )

  // Effective expansion predicate (user expansion ∪ séance-search ancestors),
  // matching the per-node isExpanded computation so navigation traverses the
  // exact on-screen set.
  const isEffectivelyExpanded = useCallback(
    (id: string) => (searchActive ? expanded.has(id) || ancestors.has(id) : expanded.has(id)),
    [searchActive, expanded, ancestors],
  )

  // The flat, in-DOM-order list of currently VISIBLE treeitems (mirrors the
  // render recursion). Memoized so the keydown handler and the roving-target
  // reconciliation below share one walk per render.
  const flat = useMemo(
    () => flattenVisible(doc.root, rootPath, isEffectivelyExpanded, childLimit),
    [doc, isEffectivelyExpanded, childLimit],
  )

  // Reconcile the roving tab stop against the visible set. `focusedId` is kept
  // as-is for the keydown logic, but the row it names can leave the DOM when an
  // ancestor is collapsed by mouse or the focused node is moved/removed by the
  // structure controls. If that happens no row would carry tabIndex 0 and a
  // Tab into the tree would have no treeitem stop. So the EFFECTIVE roving
  // target (the id we actually hand tabIndex 0) falls back to the nearest
  // still-visible ANCESTOR of the focused path, and ultimately to the root id
  // (pathId([])), which is always rendered and always visible. This only
  // guarantees a tabbable row EXISTS; it never steals document focus (that
  // stays driven by the keydown handler / user Tab).
  const effectiveFocusedId = useMemo(() => {
    const visible = new Set(flat.map((n) => n.id))
    if (visible.has(focusedId)) return focusedId
    // Walk the focused path upward, picking the first still-visible ancestor.
    let path: NbtPath
    try {
      path = parsePathId(focusedId)
    } catch {
      return pathId([])
    }
    for (let p = path.slice(0, -1); p.length > 0; p = p.slice(0, -1)) {
      const ancestorId = pathId(p)
      if (visible.has(ancestorId)) return ancestorId
    }
    // The root is always visible.
    return pathId([])
  }, [flat, focusedId])

  const registerRow = useCallback((id: string, el: HTMLElement | null) => {
    if (el) rowRefs.current.set(id, el)
    else rowRefs.current.delete(id)
  }, [])

  const onRowFocus = useCallback((id: string) => {
    setFocusedId(id)
  }, [])

  // Move the roving tab stop to `id` and give it real DOM focus.
  const focusRow = useCallback((id: string) => {
    setFocusedId(id)
    const el = rowRefs.current.get(id)
    if (el) el.focus()
  }, [])

  // Tree-level keyboard navigation. Attached to the outer <ul>; row keydown
  // events bubble up here. Guarded to ignore inline editor inputs so their own
  // Enter/Escape/arrow handling stays intact.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const target = e.target as HTMLElement
      const tag = target.tagName
      // Never hijack keys while the user is typing in an inline input/select/
      // textarea (EditableLeafValue / RenameControl / AddChildControl).
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return

      if (flat.length === 0) return
      // Resolve the current node from the treeitem that actually contains the
      // event target (robust to focus timing). The row's focusable element
      // lives inside a <li role="treeitem"> carrying data-nbt-path-json; read
      // that id. Fall back to the roving focusedId, then to the first node.
      const treeitem = target.closest('[data-nbt-path-json]') as HTMLElement | null
      const currentId = treeitem?.getAttribute('data-nbt-path-json') ?? focusedId
      let index = flat.findIndex((n) => n.id === currentId)
      if (index < 0) index = 0
      const current = flat[index]

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault()
          if (index < flat.length - 1) focusRow(flat[index + 1].id)
          break
        }
        case 'ArrowUp': {
          e.preventDefault()
          if (index > 0) focusRow(flat[index - 1].id)
          break
        }
        case 'Home': {
          e.preventDefault()
          focusRow(flat[0].id)
          break
        }
        case 'End': {
          e.preventDefault()
          focusRow(flat[flat.length - 1].id)
          break
        }
        case 'ArrowRight': {
          e.preventDefault()
          if (current.container && !current.expanded) {
            // Collapsed container: expand it (shared mouse/keyboard path).
            toggle(current.id)
          } else if (current.container && current.expanded) {
            // Already expanded: move to the first child, if any. flattenVisible
            // emits children immediately after their parent in DOM order, so
            // the first child (when present) is flat[index + 1] at depth + 1.
            // The depth guard is belt-and-suspenders: if that invariant ever
            // broke we safely no-op rather than focus a sibling.
            if (index < flat.length - 1 && flat[index + 1].depth === current.depth + 1) {
              focusRow(flat[index + 1].id)
            }
          }
          break
        }
        case 'ArrowLeft': {
          e.preventDefault()
          if (current.container && current.expanded) {
            // Expanded container: collapse it.
            toggle(current.id)
          } else if (current.path.length > 0) {
            // Leaf or collapsed container: step to the parent row.
            const parentId = pathId(current.path.slice(0, -1))
            if (rowRefs.current.has(parentId)) focusRow(parentId)
          }
          break
        }
        case 'Enter':
        case ' ':
        case 'Spacebar': {
          // Activate (toggle) a container; leaves have no toggle action here.
          if (current.container) {
            e.preventDefault()
            toggle(current.id)
          }
          break
        }
        default:
          break
      }
    },
    [flat, focusedId, focusRow, toggle],
  )

  // The nav context carries the EFFECTIVE (reconciled) id for the tabIndex
  // assignment so a tabbable row always exists even when the raw focusedId's
  // row has unmounted. The keydown logic above still reads the raw focusedId.
  const nav: TreeNav = {
    focusedId: effectiveFocusedId,
    registerRow,
    onKeyDown,
    onRowFocus,
    childLimit,
    showMore,
  }

  return (
    <ul
      role="tree"
      aria-label={`NBT tree for ${doc.name}`}
      className="font-mono text-sm"
      onKeyDown={onKeyDown}
    >
      <TreeNode
        nodeKey={doc.name || 'root'}
        tag={doc.root}
        path={rootPath}
        depth={0}
        theme={theme}
        expanded={expanded}
        toggle={toggle}
        parent={null}
        dirty={dirty}
        searchActive={searchActive}
        matches={matches}
        ancestors={ancestors}
        nav={nav}
      />
    </ul>
  )
}
