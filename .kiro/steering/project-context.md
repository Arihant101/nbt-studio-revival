---
inclusion: always
---
# Project Context (Kiroween 2026)

## Hackathon
- Kiroween 2026 (Devpost). Submission closes **Fri Dec 4, 2026, 2:00 PM PT**. Target: submit Dec 3.
- New projects only: all work happens after Oct 30, 2026.
- Categories entered: **Resurrection** (revive dead tech: NBT Studio) + **Costume Contest** (haunting, polished UI where spooky elements enhance function).
- Bonus target: Best Student (per category).

## Submission checklist
- [ ] Public GitHub repo with source, assets, run instructions
- [ ] Open-source license visible in repo About (MIT, `LICENSE`)
- [ ] `.kiro/` at repo root, committed (never gitignored)
- [ ] Working app URL (static deploy: Vercel or GitHub Pages)
- [ ] Demo video < 3 min, public on YouTube; no third-party trademarks or unlicensed music
- [ ] Text description + write-up on how Kiro was used (specs, steering, hooks, MCP)
- [ ] Request Kiro credits before Dec 1, 12:00 PM PT if needed

## Judging
- Stage 1 (pass/fail): fits the categories + meaningful Kiro use.
- Stage 2 (equal weight, 10 pts each): Potential Impact, Technological Implementation, Design, Innovation/Idea, Presentation.
- So: keep specs, steering and hooks visibly used; log notable Kiro moments for the write-up in `docs/kiro-usage.md`.

## Schedule (limited time: a few hours per week)
- W1 Oct 30 – Nov 5: specs + skeleton (done: skeleton, steering, hooks)
- W2 Nov 6 – 12: binary NBT + SNBT parsers, round-trip tests
- W3 Nov 13 – 19: tree view, inline edit, add/remove/rename/reorder, import/export
- Nov 20 – 26: off
- W5 Nov 27 – Dec 3: spooky-mode features, polish, deploy, demo video, submit
- Prefer small, shippable tasks. Cut scope before missing the deadline.

## Workflow rules
- **Never commit to `main`.** Every change goes on a branch and lands via pull request.
- Run `npm test` and `npm run typecheck` before opening a PR.

## Key decisions
- Pivoted on Oct 31 from an earlier idea (dead-repo resurrection tool) to NBT Studio Revival.
- Client-side only, custom `DataView` parser (Node NBT packages don't run in browsers).
- Two themes: `dark` (default) and `spooky`, toggled + persisted. See `product.md`.
- Demo: drop real files live (a `level.dat`, a villager entity, an enchanted book item) for the wow moment.
