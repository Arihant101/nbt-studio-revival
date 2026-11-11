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
import { childCount, formatTagValue, tagDisplay } from './tagDisplay'

/** Serialize a path to a stable string key (also used for data-nbt-path). */
function pathKey(path: NbtPath): string {
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
  const key = pathKey(path)
  const isExpanded = expanded.has(key)
  const count = childCount(tag)

  const keyLabel = nodeKey === null ? null : String(nodeKey)

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
        <span className="text-fg">{formatTagValue(tag)}</span>
      )}
    </span>
  )

  return (
    <li data-nbt-path={key} style={{ paddingLeft: `${depth * 1}rem` }}>
      {container ? (
        <button
          type="button"
          onClick={() => toggle(key)}
          aria-expanded={isExpanded}
          className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-panel focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        >
          <span className="text-muted" aria-hidden="true">
            {isExpanded ? '▾' : '▸'}
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
          key={pathKey(childPath)}
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
          key={pathKey(childPath)}
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
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['']))

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
