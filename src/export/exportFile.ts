// File export for Task 9. A pure, DOM-free module that turns the currently
// loaded NbtDocument into serialized bytes/text ready to download. It relies
// entirely on the read-only serializers (serializeBinary / serializeSnbt) and
// never mutates them or the document. Keeping it free of React and DOM-only
// globals means the serialization and filename-derivation logic is directly
// unit-testable in Vitest's default node environment.
//
// serializeBinary already re-applies doc.compression (gzip => gzipped bytes,
// none => raw), so binary export preserves the original compression without any
// extra handling here. serializeSnbt takes a bare Tag, so the SNBT branch
// passes doc.root (the Compound) and produces plain text.

import { serializeBinary } from '../nbt/binary'
import { serializeSnbt } from '../nbt/snbt'
import type { NbtDocument } from '../nbt/types'

/** The two supported export formats. */
export type ExportFormat = 'binary' | 'snbt'

/** The serialized result: filename, payload, and a MIME type for the Blob. */
export interface ExportResult {
  fileName: string
  data: Uint8Array | string
  mimeType: string
}

/**
 * Derive a download filename from the loaded document.
 *
 * Rule: base = (sourceFileName with any leading directory stripped) if
 * non-empty, else docName if non-empty, else 'document'. A trailing
 * .nbt/.dat/.snbt extension (case-insensitive) is stripped from the base, then
 * the correct extension for the chosen format is appended ('.nbt' for binary,
 * '.snbt' for snbt).
 *
 * Examples: 'level.dat' -> 'level.nbt' (binary) / 'level.snbt' (snbt);
 * 'foo' (no known extension) -> 'foo.nbt'.
 */
export function deriveExportFileName(
  sourceFileName: string | null,
  docName: string,
  format: ExportFormat,
): string {
  const fromSource = (sourceFileName ?? '').split(/[\\/]/).pop() ?? ''
  const rawBase = fromSource !== '' ? fromSource : docName !== '' ? docName : 'document'
  const base = rawBase.replace(/\.(nbt|dat|snbt)$/i, '')
  const extension = format === 'binary' ? '.nbt' : '.snbt'
  return `${base}${extension}`
}

/**
 * Serialize `doc` into the requested `format`, returning the download filename,
 * payload, and MIME type. Read-only over the document: it never mutates it.
 * Serializers may throw on an invalid in-memory doc; those errors propagate so
 * the caller (App) can surface them.
 */
export async function exportDocument(
  doc: NbtDocument,
  sourceFileName: string | null,
  format: ExportFormat,
): Promise<ExportResult> {
  const fileName = deriveExportFileName(sourceFileName, doc.name, format)

  if (format === 'binary') {
    const data = await serializeBinary(doc)
    return { fileName, data, mimeType: 'application/octet-stream' }
  }

  const data = serializeSnbt(doc.root)
  return { fileName, data, mimeType: 'text/plain' }
}
