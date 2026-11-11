// A representative NbtDocument used to exercise the tree view in development
// (via the "Load sample" affordance in App.tsx) and in component tests, before
// real file import lands in Task 8. Covers every tag type: nested Compound, a
// List of compounds and a List of ints, all scalar types, and the three typed
// arrays. This is a NEW file; it does not modify any read-only src/nbt file.

import type { NbtDocument, Tag } from '../nbt/types'
import { TagType } from '../nbt/types'

/** Build a fresh sample document covering every tag type. */
export function sampleDocument(): NbtDocument {
  return {
    name: 'Level',
    compression: 'none',
    root: {
      type: TagType.Compound,
      value: new Map<string, Tag>([
        ['byteTag', { type: TagType.Byte, value: 7 }],
        ['shortTag', { type: TagType.Short, value: 1200 }],
        ['intTag', { type: TagType.Int, value: 42 }],
        // Deliberately larger than Number.MAX_SAFE_INTEGER to prove the tree
        // renders Long values at full precision (bigint, never Number()).
        ['longTag', { type: TagType.Long, value: 9223372036854775807n }],
        ['floatTag', { type: TagType.Float, value: 3.5 }],
        ['doubleTag', { type: TagType.Double, value: 2.718281828 }],
        ['stringTag', { type: TagType.String, value: 'hello world' }],
        [
          'byteArrayTag',
          { type: TagType.ByteArray, value: new Int8Array([1, 2, 3, 4, 5, 6, 7, 8]) },
        ],
        [
          'intArrayTag',
          { type: TagType.IntArray, value: new Int32Array([10, 20, 30, 40, 50]) },
        ],
        [
          'longArrayTag',
          {
            type: TagType.LongArray,
            value: new BigInt64Array([100n, 200n, 300n, 400n]),
          },
        ],
        [
          'intList',
          {
            type: TagType.List,
            elementType: TagType.Int,
            value: [
              { type: TagType.Int, value: 100 },
              { type: TagType.Int, value: 200 },
              { type: TagType.Int, value: 300 },
            ],
          },
        ],
        [
          'compoundList',
          {
            type: TagType.List,
            elementType: TagType.Compound,
            value: [
              {
                type: TagType.Compound,
                value: new Map<string, Tag>([
                  ['id', { type: TagType.String, value: 'minecraft:stone' }],
                  ['count', { type: TagType.Byte, value: 64 }],
                ]),
              },
              {
                type: TagType.Compound,
                value: new Map<string, Tag>([
                  ['id', { type: TagType.String, value: 'minecraft:dirt' }],
                  ['count', { type: TagType.Byte, value: 32 }],
                ]),
              },
            ],
          },
        ],
        [
          'nested',
          {
            type: TagType.Compound,
            value: new Map<string, Tag>([
              ['enabled', { type: TagType.Byte, value: 1 }],
              ['label', { type: TagType.String, value: 'deeply nested' }],
              [
                'inner',
                {
                  type: TagType.Compound,
                  value: new Map<string, Tag>([
                    ['leaf', { type: TagType.Int, value: 999 }],
                  ]),
                },
              ],
            ]),
          },
        ],
      ]),
    },
  }
}
