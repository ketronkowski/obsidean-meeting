# Attendee Extraction Skill

> **Legacy design note — not loaded by the plugin.** This skill file is no longer read by `SkillLoader.getSkill()`; the logic it describes has been hard-coded in TypeScript. Kept for historical/design reference only. See `docs/REFERENCE.md` §10.

## Purpose
Extract meeting attendees from screenshots or content and create/link People profiles.

## Extraction Methods

### Method 1: Screenshot Analysis (Preferred)
When meeting contains `![[SCR-*.png]]` references:

1. **Locate Screenshots**
   - Find all `![[SCR-*.png]]` image references
   - These are typically Teams participant screenshots

2. **Vision Analysis**
   - Use vision capabilities to read names from images
   - Extract each participant's full name
   - Handle various screenshot formats and layouts

3. **Profile Matching**
   - Search People folder for existing profiles
   - Match by exact name or fuzzy match
   - Create new profiles for unknown attendees

### Method 2: Content Extraction (Fallback)
When no screenshots available:

1. **Name Detection**
   - Scan transcript for speaker names
   - Look for name patterns in meeting content
   - Extract from attendee mentions

2. **Profile Matching**
   - Search existing People profiles
   - Match detected names to known profiles
   - Only link if confident match (>80% similarity)

## People Profile Creation

### Profile Template
Real output (`people-manager.ts` `createProfile`/`createProfileWithBody`) is
frontmatter-only — no body sections:
```markdown
---
aliases:
  - [Full Name]
tags:
  - People
---
```
The email-chain handler (`createProfileWithBody`) may also inject an `email:`
frontmatter line and a Copilot-generated body below the frontmatter.

### File Location
`{peopleFolder}/[Full Name].md`

Example: `People/John Smith.md`

## Attendees Section Update

Replace or populate the `# Attendees` section:

```markdown
# Attendees

## In Meeting (3)
- [[John Smith]]
- [[Jane Doe]]
- [[Alice Johnson]]
```

## Error Handling
- If screenshot analysis fails: fall back to content extraction
- If no attendees detected: leave section unchanged with comment
- If profile creation fails: use plain text name without link
- Log all extraction attempts for debugging
