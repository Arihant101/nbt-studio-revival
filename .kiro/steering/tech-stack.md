---
inclusion: always
---
# Tech Stack
- React 19 + TypeScript (strict mode)
- Vite for build tooling
- Zustand for state management (not Redux)
- Tailwind CSS v4 for styling (via `@tailwindcss/vite`, theme tokens in `src/index.css`)
- No backend. All NBT parsing happens in the browser.
- Write a custom NBT parser on `DataView` (Node-only packages like `nbt`/`prismarine-nbt` depend on `Buffer`/`zlib`). Use the browser's `DecompressionStream`/`CompressionStream` for gzip.
- Tag model lives in `src/nbt/types.ts`. Do not invent a parallel model.
