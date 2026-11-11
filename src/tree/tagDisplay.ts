// Single source of truth for per-tag-type presentation (label, sigil, color)
// and leaf-value / child-count formatting used by the tree view and later
// edit UI. Pure functions only - no React here.
//
// Product steering requires that all themed icons/labels route through ONE
// copy/sigil map (never ad-hoc ternaries), that sigils use our own
// emoji/unicode (no Minecraft assets), and that colors reference only the
// semantic Tailwind token utilities defined in src/index.css.

import type { Tag, TagType } from '../nbt/types'
import { TagType as T } from '../nbt/types'
import type { Theme } from '../store/useThemeStore'

/** Allowed semantic color token utility classes (never raw hex). */
export type SemanticColor = 'text-accent' | 'text-fg' | 'text-muted' | 'text-danger'

export interface TagDisplay {
  /** Human-readable type label, e.g. 'Compound', 'Int'. */
  label: string
  /** Theme-specific glyph (our own emoji/unicode only). */
  sigil: string
  /** Semantic Tailwind color token utility class. */
  color: SemanticColor
}

interface TagDescriptor {
  label: string
  color: SemanticColor
  /** Sigil per theme. */
  sigils: Record<Theme, string>
}

// One descriptor per TagType. Using a typed Record over TagType means the
// compiler enforces that every tag type (End..LongArray) is handled.
const DESCRIPTORS: Record<TagType, TagDescriptor> = {
  [T.End]: { label: 'End', color: 'text-muted', sigils: { dark: '∅', spooky: '🕸️' } },
  [T.Byte]: { label: 'Byte', color: 'text-accent', sigils: { dark: 'b', spooky: '🦇' } },
  [T.Short]: { label: 'Short', color: 'text-accent', sigils: { dark: 's', spooky: '🕷️' } },
  [T.Int]: { label: 'Int', color: 'text-accent', sigils: { dark: '#', spooky: '🔢' } },
  [T.Long]: { label: 'Long', color: 'text-accent', sigils: { dark: 'L', spooky: '⛓️' } },
  [T.Float]: { label: 'Float', color: 'text-accent', sigils: { dark: 'f', spooky: '🌫️' } },
  [T.Double]: { label: 'Double', color: 'text-accent', sigils: { dark: 'd', spooky: '🌙' } },
  [T.ByteArray]: { label: 'ByteArray', color: 'text-muted', sigils: { dark: '[b]', spooky: '🦴' } },
  [T.String]: { label: 'String', color: 'text-fg', sigils: { dark: '"', spooky: '📜' } },
  [T.List]: { label: 'List', color: 'text-fg', sigils: { dark: '[]', spooky: '🦴' } },
  [T.Compound]: { label: 'Compound', color: 'text-fg', sigils: { dark: '{}', spooky: '💀' } },
  [T.IntArray]: { label: 'IntArray', color: 'text-muted', sigils: { dark: '[#]', spooky: '🧮' } },
  [T.LongArray]: { label: 'LongArray', color: 'text-muted', sigils: { dark: '[L]', spooky: '⛓️' } },
}

/** Label + semantic color for a tag type (theme-independent). */
export function tagTypeInfo(type: TagType): { label: string; color: SemanticColor } {
  const d = DESCRIPTORS[type]
  return { label: d.label, color: d.color }
}

/** Theme-specific sigil glyph for a tag type. */
export function sigil(type: TagType, theme: Theme): string {
  return DESCRIPTORS[type].sigils[theme]
}

/** Full display descriptor (label + sigil + color) for a tag type and theme. */
export function tagDisplay(type: TagType, theme: Theme): TagDisplay {
  const d = DESCRIPTORS[type]
  return { label: d.label, sigil: d.sigils[theme], color: d.color }
}

/** Max number of elements shown in a typed-array preview before eliding. */
const PREVIEW_LIMIT = 3

function previewArray(name: string, length: number, items: string[]): string {
  const shown = items.slice(0, PREVIEW_LIMIT)
  const body = length > PREVIEW_LIMIT ? [...shown, '…'].join(', ') : shown.join(', ')
  return `${name}(${length}) [${body}]`
}

/**
 * Render a leaf tag's value as a readable string.
 *
 * Long values use String() on the bigint (never Number(), which would lose
 * precision above Number.MAX_SAFE_INTEGER). Typed arrays render as a length
 * plus a short bounded preview rather than dumping every element. Container
 * tags (Compound/List) have no scalar value - use childCount() instead; this
 * function returns an empty string for them.
 */
export function formatTagValue(tag: Tag): string {
  switch (tag.type) {
    case T.Byte:
    case T.Short:
    case T.Int:
    case T.Float:
    case T.Double:
      return String(tag.value)
    case T.Long:
      return String(tag.value)
    case T.String:
      return tag.value
    case T.ByteArray: {
      const items: string[] = []
      for (let i = 0; i < Math.min(tag.value.length, PREVIEW_LIMIT); i++) {
        items.push(String(tag.value[i]))
      }
      return previewArray('Int8Array', tag.value.length, items)
    }
    case T.IntArray: {
      const items: string[] = []
      for (let i = 0; i < Math.min(tag.value.length, PREVIEW_LIMIT); i++) {
        items.push(String(tag.value[i]))
      }
      return previewArray('Int32Array', tag.value.length, items)
    }
    case T.LongArray: {
      const items: string[] = []
      for (let i = 0; i < Math.min(tag.value.length, PREVIEW_LIMIT); i++) {
        items.push(String(tag.value[i]))
      }
      return previewArray('BigInt64Array', tag.value.length, items)
    }
    case T.Compound:
    case T.List:
      return ''
  }
}

/**
 * Number of children for a container tag: Map size for Compound, array length
 * for List, null for every leaf tag.
 */
export function childCount(tag: Tag): number | null {
  switch (tag.type) {
    case T.Compound:
      return tag.value.size
    case T.List:
      return tag.value.length
    case T.Byte:
    case T.Short:
    case T.Int:
    case T.Long:
    case T.Float:
    case T.Double:
    case T.ByteArray:
    case T.String:
    case T.IntArray:
    case T.LongArray:
      return null
  }
}
