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

import { useCallback, useState } from 'react'
import type { NbtDocument, Tag } from '../nbt/types'
import { TagType } from '../nbt/types'
import type { NbtPath } from '../nbt/edit'
import { useThemeStore, type Theme } from '../store/useThemeStore'
import { childCount, tagDisplay } from './tagDisplay'
import { EditableLeafValue } from './EditableLeafValue'

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

interface TreeNodeProps {
  /** Label shown for this node: a Compound child key or a List index. */
  nodeKey: string | number | null
  tag: Tag
  path: NbtPath
  depth: number
  theme: Theme
  expanded: Set<string>
  toggle: (key: string) => void
}

function TreeNode({ nodeKey, tag, path, depth, theme, expanded, toggle }: TreeNodeProps) {
  const display = tagDisplay(tag.type, theme)
  const container = isContainer(tag)
  // Identity/addressing uses the injective JSON form; the slash-joined form is
  // display-only (data-nbt-path) for human-readability.
  const id = pathId(path)
  const displayPath = pathDisplay(path)
  const isExpanded = expanded.has(id)
  const count = childCount(tag)

  const keyLabel = nodeKey === null ? null : String(nodeKey)
  // Accessible name for the editable leaf control: the Compound key / List
  // index when present, otherwise the tag type label.
  const leafLabel = keyLabel ?? display.label

  const rowContent = (
    <span className="flex items-center gap-2">
      <span className={display.color} aria-hidden="true">
        {display.sigil}
      </span>
      <span className="text-muted">{display.label}</span>
      {keyLabel !== null && <span className="text-accent">{keyLabel}</span>}
      {container ? (
        <span className="text-muted">({count})</span>
      ) : (
        <EditableLeafValue tag={tag} path={path} theme={theme} label={leafLabel} />
      )}
    </span>
  )

  return (
    <li data-nbt-path={displayPath} data-nbt-path-json={id} style={{ paddingLeft: `${depth * 1}rem` }}>
      {container ? (
        <button
          type="button"
          onClick={() => toggle(id)}
          aria-expanded={isExpanded}
          className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-panel focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
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
      ) : (
        <div className="flex items-center gap-2 px-1 py-0.5">
          <span className="inline-block w-[1ch]" aria-hidden="true" />
          {rowContent}
        </div>
      )}
      {container && isExpanded && (
        <ul className="border-l border-edge">
          {renderChildren(tag, path, depth + 1, theme, expanded, toggle)}
        </ul>
      )}
    </li>
  )
}

function renderChildren(
  tag: Tag,
  path: NbtPath,
  depth: number,
  theme: Theme,
  expanded: Set<string>,
  toggle: (key: string) => void,
) {
  if (tag.type === TagType.Compound) {
    const entries = [...tag.value.entries()]
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
        />
      )
    })
  }
  if (tag.type === TagType.List) {
    return tag.value.map((childTag, index) => {
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
        />
      )
    })
  }
  return null
}

export interface NbtTreeProps {
  /** The document to render. Its root compound is shown first. */
  doc: NbtDocument
}

/** Collapsible, read-only tree view of an NBT document. */
export function NbtTree({ doc }: NbtTreeProps) {
  const theme = useThemeStore((s) => s.theme)
  // Root ([]) starts expanded; deeper containers start collapsed.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([pathId([])]))

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

  return (
    <ul className="font-mono text-sm" aria-label={`NBT tree for ${doc.name}`}>
      <TreeNode
        nodeKey={doc.name || 'root'}
        tag={doc.root}
        path={rootPath}
        depth={0}
        theme={theme}
        expanded={expanded}
        toggle={toggle}
      />
    </ul>
  )
}
