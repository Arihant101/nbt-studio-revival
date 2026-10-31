// NBT tag model. IDs match the Java Edition binary format.
export const TagType = {
  End: 0,
  Byte: 1,
  Short: 2,
  Int: 3,
  Long: 4,
  Float: 5,
  Double: 6,
  ByteArray: 7,
  String: 8,
  List: 9,
  Compound: 10,
  IntArray: 11,
  LongArray: 12,
} as const
export type TagType = (typeof TagType)[keyof typeof TagType]

export type Tag =
  | { type: typeof TagType.Byte; value: number }
  | { type: typeof TagType.Short; value: number }
  | { type: typeof TagType.Int; value: number }
  | { type: typeof TagType.Long; value: bigint }
  | { type: typeof TagType.Float; value: number }
  | { type: typeof TagType.Double; value: number }
  | { type: typeof TagType.ByteArray; value: Int8Array }
  | { type: typeof TagType.String; value: string }
  | { type: typeof TagType.List; elementType: TagType; value: Tag[] }
  | { type: typeof TagType.Compound; value: Map<string, Tag> }
  | { type: typeof TagType.IntArray; value: Int32Array }
  | { type: typeof TagType.LongArray; value: BigInt64Array }

/** A parsed file: root tag name + root compound + whether it was gzipped. */
export interface NbtDocument {
  name: string
  root: Extract<Tag, { type: typeof TagType.Compound }>
  compression: 'none' | 'gzip'
}
