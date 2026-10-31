import type { NbtDocument } from './types'

// TODO(Kiro spec task 1): big-endian DataView reader/writer, gzip via DecompressionStream.
export async function parseBinary(_bytes: Uint8Array): Promise<NbtDocument> {
  throw new Error('parseBinary not implemented')
}

export async function serializeBinary(_doc: NbtDocument): Promise<Uint8Array> {
  throw new Error('serializeBinary not implemented')
}
