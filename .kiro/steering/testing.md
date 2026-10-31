---
inclusion: always
---
# Testing
- Use Vitest (`npm test`). Tests sit next to code as `*.test.ts`.
- Every NBT type must have round-trip tests (parse → serialize → parse → deep-equal).
- Include real Minecraft samples in `src/nbt/fixtures/` (level.dat, entity, structure). Keep each under 100 KB.
- Run `npm test` and `npm run typecheck` before marking any task complete.
