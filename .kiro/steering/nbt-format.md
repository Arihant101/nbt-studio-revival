---
inclusion: fileMatch
fileMatchPattern: "src/nbt/**"
---
# NBT Binary Format (Java Edition)
- Big-endian byte order.
- Files are usually **gzip-compressed** (`level.dat`, `.nbt` structures). Detect magic bytes `1f 8b`; remember compression so export matches.
- File = one named root tag: type byte (10 = Compound) + name (u16 length + bytes) + payload.
- Tag IDs: 0=End, 1=Byte, 2=Short, 3=Int, 4=Long, 5=Float, 6=Double, 7=ByteArray, 8=String, 9=List, 10=Compound, 11=IntArray, 12=LongArray.
- Strings: u16 length prefix + Modified UTF-8 (plain UTF-8 is fine except NUL and 4-byte chars).
- List: element type byte + i32 count + payloads (no names). Empty list may have type 0 (End).
- Compound: named tags until a single 0 (End) byte.
- Arrays: i32 count + elements (i8 / i32 / i64).
- Long and LongArray use `bigint` / `BigInt64Array`.

# SNBT (text)
- Compound `{key:value,...}`, list `[a,b]`, typed arrays `[B;1b,2b]`, `[I;1,2]`, `[L;1L,2L]`.
- Number suffixes: `b` byte, `s` short, none/int, `L` long, `f` float, `d` double (bare decimal = double).
- Strings: quoted with `"` or `'` (escape `\`), unquoted allowed if `[A-Za-z0-9._+-]+`.
- Keys: same quoting rules as strings.
