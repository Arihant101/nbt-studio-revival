# 🎃 NBT Studio Revival

NBT Studio, the beloved Minecraft NBT editor, died. We dug it up and put it in your browser.

Built with [Kiro](https://kiro.dev) for **Kiroween 2026** — entered in the **Resurrection** category (reviving the unmaintained NBT Studio desktop app) and the **Costume Contest** category (the spooky theme).

**Live app:** https://nbt-studio-revival.vercel.app/

## Features

- **Full NBT support** — parse and serialize binary NBT (`.nbt`, `.dat`), gzip-compressed or raw, plus SNBT text (`.snbt`). Every tag type is handled: Byte, Short, Int, Long (bigint), Float, Double, ByteArray, String, List, Compound, IntArray, and LongArray (bigint).
- **Collapsible tree view** — browse the document as a tree with distinct per-type sigils and keyboard-accessible navigation.
- **Inline value editing** — edit leaf values in place with per-type validation.
- **Structure editing** — add, remove, rename, and reorder tags.
- **Import** — load files via the file picker or by drag-and-drop.
- **Export** — write back to binary `.nbt` (keeping the original compression) or to `.snbt` text.
- **Two themes** — a `dark` default and a `spooky` Costume-Contest theme, toggled in the header and persisted. The spooky features enhance function rather than just decoration:
  - **Graveyard undo** — deleted tags go to a graveyard panel you can restore from.
  - **Haunted indicators** — unsaved edits are marked as "haunted" and clear once you export.
  - **Séance search** — search highlights matching tags.
  - **Cursed import errors** — parse failures surface the location in the file where they occurred.
- **Accessible** — keyboard-navigable tree, respects `prefers-reduced-motion`, and targets WCAG AA contrast.
- **Fully client-side** — no backend. All NBT parsing and serialization run in the browser (a custom `DataView` parser; gzip via the browser's `DecompressionStream`/`CompressionStream`).

## Run / Development

```bash
npm install

npm run dev        # Vite dev server at http://localhost:5173
npm test           # run the test suite with vitest (185 tests)
npm run test:watch # vitest in watch mode
npm run typecheck  # tsc -b --noEmit
npm run build      # tsc -b && vite build
npm run preview    # preview the production build
```

## Project layout

- `src/nbt/` — core NBT model and codecs
  - `binary.ts` — binary parser/serializer
  - `snbt.ts` — SNBT parser and pretty-printer
  - `edit.ts` — pure, path-based immutable edit core
  - `types.ts` — authoritative tag model
  - `roundtrip.test.ts`, `fixtures/level.dat` — tests and a gzip NBT sample
- `src/store/` — Zustand state
  - `useNbtStore.ts` — document, edit actions, graveyard/undo, haunted-dirty tracking
  - `useThemeStore.ts` — persisted dark/spooky theme
- `src/tree/` — tree UI
  - `NbtTree.tsx` — collapsible, keyboard-navigable tree
  - `EditableLeafValue.tsx` — inline value editing
  - `StructureControls.tsx` — add/remove/rename/reorder
  - `Graveyard.tsx` — deleted-tags/undo panel
  - `tagDisplay.ts` — sigil/label/color helper
  - `searchMatch.ts` — séance search matching
  - `sampleDocument.ts` — demo document
- `src/import/` — `importFile.ts` (format detection + parse), `parseErrorLocation.ts` (cursed-error location extraction)
- `src/export/` — `exportFile.ts` (serialize + filename), `download.ts` (browser download trigger)
- `src/App.tsx` — app shell: header controls, import drop zone, tree, graveyard, and séance search

## Built with Kiro

This project was built with [Kiro](https://kiro.dev), and the `.kiro/` directory is committed:

- `.kiro/steering/` — product, tech-stack, nbt-format, testing, and project-context rules Kiro follows
- `.kiro/hooks/` — typecheck on save, and run the parser tests when `src/nbt` changes
- `SPEC_PROMPT.md` — the spec prompt used to drive Kiro's spec

## License

MIT — see [LICENSE](LICENSE).
