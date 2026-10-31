# Kiro spec prompt (paste into Specs → New Spec → Requirements-First)

Build NBT Studio Revival: a web-based NBT (Named Binary Tag) editor for Minecraft Java Edition that resurrects the unmaintained NBT Studio desktop app. It should:
- Parse and serialize binary NBT (.nbt, .dat), gzip-compressed or raw, and SNBT text (.snbt)
- Display NBT data in a collapsible tree view with inline editing
- Support all NBT types: Byte, Short, Int, Long, Float, Double, ByteArray, String, List, Compound, IntArray, LongArray
- Allow adding, removing, renaming, and reordering keys
- Import files via file picker or drag-and-drop
- Export as binary .nbt (keeping original compression) or .snbt
- Use the existing skeleton: React 19 + TypeScript + Vite + Zustand + Tailwind, tag model in src/nbt/types.ts
- No backend: everything runs client-side in the browser
- Two themes toggled in the header and persisted: dark (default) and spooky (Costume Contest). Spooky mode must enhance function: deleted tags go to a Graveyard you can resurrect from (undo), unsaved edits glow as "haunted", parse errors show a "cursed" marker at the exact byte/line, each tag type has a distinct sigil. See the product steering file.

Target task order: 1 binary parser, 2 SNBT, 3 round-trip tests, 4 Zustand edit actions, 5 tree view, 6 inline edit, 7 add/remove/rename/reorder, 8 import, 9 export, 10 spooky-mode features (graveyard undo, haunted edits, cursed errors, sigils), 11 polish (keyboard nav, error/empty states, reduced motion).
