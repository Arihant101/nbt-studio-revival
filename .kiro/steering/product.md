---
inclusion: always
---
# Product
- **NBT Studio Revival**: a browser-based NBT editor for Minecraft Java Edition.
- Resurrects NBT Studio, a popular desktop NBT editor that is no longer maintained. Same core job, zero install, runs anywhere.
- Hackathon: Kiroween 2026. Categories: **Resurrection** (reviving dead tech) + **Costume Contest** (haunting, polished UI).

# Themes
- Two themes, toggled in the header and persisted (`src/store/useThemeStore.ts`): **dark** (default, clean) and **spooky** (Costume Contest).
- Theme = `data-theme` on `<html>`. Colors are semantic Tailwind tokens in `src/index.css`: `bg`, `panel`, `edge`, `accent`, `fg`, `muted`, `danger`. Use tokens, never raw hex.
- Any themed text/icon goes through one helper (e.g. `t(dark, spooky)` or a copy map), not ad-hoc ternaries.

# Spooky mode must enhance function, not just decorate
Same features in both themes; spooky mode re-skins them so the UI explains itself:
- **Graveyard**: deleted tags go to a tombstone list and can be resurrected (this is the undo system).
- **Haunted tags**: unsaved edits glow/flicker softly until exported, so you see what changed.
- **Cursed file**: parse errors show the byte offset / SNBT line with a crack effect on the bad spot.
- **Type sigils**: each tag type has a distinct icon + color (e.g. skull = Compound, bones = List), readable at a glance.
- **Séance search**: search/filter highlights matches with a lantern glow and dims the rest.
- Respect `prefers-reduced-motion`: no flicker/animation when set. Keep contrast WCAG AA in both themes.

# Hackathon rules that affect code
- No Minecraft textures, logos, fonts, or sounds (third-party trademarks). Use our own icons/emoji.
- `.kiro/` stays committed (required for judging). Keep an MIT LICENSE at repo root.
- App must deploy as a static site (Vercel or GitHub Pages) for the required working URL.
