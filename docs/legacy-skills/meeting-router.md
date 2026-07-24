# Meeting Router Skill

> **Legacy design note — not loaded by the plugin.** This skill file is no longer read by `SkillLoader.getSkill()`; the logic it describes has been hard-coded in TypeScript. Kept for historical/design reference only. See `docs/REFERENCE.md` §10.

## Purpose
Detect whether a meeting is a standup or general meeting based on filename patterns.

## Detection Logic

### Standup Meeting
A meeting is classified as a standup if the filename contains any of these keywords:
- "Green Standup"

### General Meeting
Any meeting that doesn't match standup criteria is classified as general.

## Examples

**Standup meetings:**
- `2026-02-05 - Green Standup.md`

**General meetings:**
- `2026-02-05 - Product Planning.md`
- `2026-02-05 - Sprint Review.md`
- `2026-02-05 - 1:1 with Manager.md`
