// Cursed-file import errors (Task 10, increment D). A pure, framework-free
// helper that extracts a structured location from a parser error WITHOUT
// touching the read-only parsers.
//
// The SNBT parser (src/nbt/snbt.ts) throws Error messages that END with
// `... at position ${pos}`, where pos is a 0-based CHARACTER offset into the
// SNBT text (e.g. 'Unexpected trailing characters at position 5'). The binary
// parser (src/nbt/binary.ts) throws STRUCTURAL errors with no such suffix, and
// a non-Compound SNBT root throws 'SNBT root must be a Compound tag, got <T>'
// with no position either. For those we report that no location is known.
//
// Kept pure and defensive: it accepts an Error OR a raw message string, never
// throws on any input (empty string, non-numeric, undefined-ish), and returns a
// typed discriminated union so callers must handle both arms. No `any`.

/**
 * Where an import parse error occurred, if the message carried a location.
 *
 *  - `position`: a character offset into the SNBT text (from the SNBT parser).
 *  - `none`: no location is available (structural binary error, non-Compound
 *    root, or any message without a trailing 'at position N').
 */
export type ParseErrorLocation = { kind: 'position'; position: number } | { kind: 'none' }

/** Matches a trailing 'at position <digits>' at the very end of the message. */
const POSITION_RE = /at position (\d+)\s*$/

/**
 * Extract the parse location from an import error or its message string.
 *
 * Returns `{ kind: 'position', position: N }` when the message ends with
 * 'at position N' (N a non-negative integer), otherwise `{ kind: 'none' }`.
 * Never throws, regardless of input.
 */
export function parseErrorLocation(error: unknown): ParseErrorLocation {
  const message = messageOf(error)
  const match = POSITION_RE.exec(message)
  if (match === null) return { kind: 'none' }
  const position = Number.parseInt(match[1]!, 10)
  if (!Number.isFinite(position)) return { kind: 'none' }
  return { kind: 'position', position }
}

/** Safely coerce an Error/string/unknown into a message string. */
function messageOf(error: unknown): string {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message
  }
  return ''
}
