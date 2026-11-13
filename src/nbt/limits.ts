// Safety limits applied to untrusted input. NBT files come from anywhere (a
// friend's world, a download, a crafted file), so the parsers enforce these
// caps up front instead of letting a malicious file freeze or crash the tab.

/** Max nesting depth of Compounds/Lists. Matches Minecraft's own limit (512). */
export const MAX_DEPTH = 512

/** Max bytes after gzip/zlib inflation (defends against decompression bombs). */
export const MAX_DECOMPRESSED_BYTES = 256 * 1024 * 1024

/** Max total number of tags in one document (each tag costs JS heap). */
export const MAX_TAGS = 5_000_000

/** Max size of a file the importer will even read. */
export const MAX_FILE_BYTES = 128 * 1024 * 1024
