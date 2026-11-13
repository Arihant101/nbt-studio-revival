// Séance search (Task 10, increment C): pure, view-local matching over the
// loaded NBT tree. No React, no store, no DOM here - just a walk of the tag
// model that returns path-id sets so the tree view can highlight matches and
// force-expand their ancestors.
//
// A node MATCHES when its key (a Compound child key, or a List index rendered
// as a string) OR its formatted leaf value contains the query (case
// insensitive). Matching uses the SAME value string the tree renders, via
// formatTagValue, so what the user sees is what they search. Containers have
// no scalar value (formatTagValue returns '') so they match on key only.
//
// Path ids are JSON.stringify(path) to line up exactly with NbtTree's
// expansion Set and its `data-nbt-path-json` attribute, so ancestor ids can be
// unioned straight into the effective expansion set.

import type { Tag } from '../nbt/types'
import { TagType } from '../nbt/types'
import type { NbtPath } from '../nbt/edit'
import { formatTagValue } from './tagDisplay'

/** Result of a search walk: matching node ids and all their ancestor ids. */
export interface SearchMatches {
  /** JSON path ids of nodes whose key or value contains the query. */
  matches: Set<string>
  /**
   * JSON path ids of every ancestor of a match. Union this into the
   * expansion set to force matches visible; it never includes a match's own
   * id unless that node is also an ancestor of a deeper match.
   */
  ancestors: Set<string>
}

/** Serialize a path the same way NbtTree does (injective, round-trippable). */
function pathId(path: NbtPath): string {
  return JSON.stringify(path)
}

/**
 * Whether a single node's own key/value text contains the (already
 * normalized: trimmed + lowercased) query. `nodeKey` is the Compound key or
 * List index for this node, or null for the root.
 */
function nodeSelfMatches(tag: Tag, nodeKey: string | number | null, query: string): boolean {
  if (nodeKey !== null && String(nodeKey).toLowerCase().includes(query)) {
    return true
  }
  const value = formatTagValue(tag)
  return value !== '' && value.toLowerCase().includes(query)
}

/**
 * Walk the whole tree rooted at `root` and collect, for the normalized
 * `query`, the ids of matching nodes and of every ancestor path leading to a
 * match. An empty/whitespace-only query yields empty sets (search inactive).
 *
 * Pure and exported so it can be unit-tested directly against sampleDocument
 * without rendering: assert both key matches (e.g. 'stringTag') and value
 * matches (e.g. 'hello', 'minecraft:stone') plus their ancestors.
 */
export function computeMatches(root: Tag, rawQuery: string): SearchMatches {
  const matches = new Set<string>()
  const ancestors = new Set<string>()
  const query = rawQuery.trim().toLowerCase()
  if (query === '') {
    return { matches, ancestors }
  }

  // Depth-first walk. `path` is this node's real NbtPath; `nodeKey` is the key
  // or index it was reached by (null for the root). Returns whether this
  // subtree contains any match so each ancestor can record itself.
  function visit(tag: Tag, path: NbtPath, nodeKey: string | number | null): boolean {
    let subtreeHasMatch = false

    if (tag.type === TagType.Compound) {
      for (const [childKey, childTag] of tag.value) {
        if (visit(childTag, [...path, childKey], childKey)) {
          subtreeHasMatch = true
        }
      }
    } else if (tag.type === TagType.List) {
      tag.value.forEach((childTag, index) => {
        if (visit(childTag, [...path, index], index)) {
          subtreeHasMatch = true
        }
      })
    }

    const selfMatches = nodeSelfMatches(tag, nodeKey, query)
    if (selfMatches) {
      matches.add(pathId(path))
    }
    // This node is an ancestor-of-a-match when a descendant matched. Record it
    // so the tree can force-expand it; a node that is both an ancestor and a
    // match ends up in both sets, which is fine (expansion only reads
    // ancestors, highlight only reads matches).
    if (subtreeHasMatch) {
      ancestors.add(pathId(path))
    }

    return selfMatches || subtreeHasMatch
  }

  visit(root, [], null)
  return { matches, ancestors }
}
