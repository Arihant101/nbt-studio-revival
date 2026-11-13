// Thin, DOM-only download trigger for Task 9. Kept separate from the pure
// exportFile helper so the serialization/filename logic stays unit-testable in
// the node env while this tiny browser-only piece (Blob + object URL + a
// temporary anchor click) lives on its own. It need not be unit-tested; jsdom
// may not provide URL.createObjectURL.

import type { ExportResult } from './exportFile'

/**
 * Trigger a browser download of an already-serialized export result by building
 * a Blob, creating an object URL, clicking a temporary <a download>, and
 * revoking the URL afterwards.
 */
export function triggerDownload(result: ExportResult): void {
  const blob = new Blob([result.data as BlobPart], { type: result.mimeType })
  const url = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = result.fileName
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
  } finally {
    // Revoking synchronously can cancel the download in some browsers
    // (Firefox/Safari start the fetch asynchronously). Defer it so the URL is
    // still released (no leaked Blob) but only after the download has begun.
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
}
