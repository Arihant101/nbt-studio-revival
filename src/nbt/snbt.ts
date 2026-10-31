import type { Tag } from './types'

// TODO(Kiro spec task 2): SNBT tokenizer + parser + pretty printer.
export function parseSnbt(_text: string): Tag {
  throw new Error('parseSnbt not implemented')
}

export function serializeSnbt(_tag: Tag): string {
  throw new Error('serializeSnbt not implemented')
}
