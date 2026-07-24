# Meeting Processor Plugin — Developer Context for Claude

This file is automatically read by Claude Code (and Claude CLI tools) to provide project context.

## What This Project Is

An **Obsidian plugin** (`id: obsidean-meeting`) that automates meeting note and email chain note processing using the **GitHub Copilot CLI** as its AI backend. It processes standup meetings, general meetings, and email chain notes with a single ribbon click or command palette action.

- **Language**: TypeScript, compiled to CommonJS via esbuild
- **Runtime**: Obsidian desktop/mobile app (Electron-based)
- **AI**: GitHub Copilot CLI (`copilot -p <prompt>`) spawned as child processes
- **JIRA**: Atlassian REST API (agile board endpoints) with Basic Auth

The plugin is deployed to Obsidian via a **symlink** from the vault's `.obsidian/plugins/obsidean-meeting` → `~/git/obsidean-meeting`.

---

## Repository Layout

```
obsidean-meeting/
├── main.ts                           # Plugin entry point; registers ribbon, command, settings
├── manifest.json                     # Obsidian plugin manifest (id, name, version)
├── package.json                      # npm metadata + build scripts
├── esbuild.config.mjs                # Build config: bundles to main.js (CJS, ES2020)
├── tsconfig.json                     # Strict TS; ESNext module, DOM+ES2020 libs
├── styles.css                        # CSS for modals (CopilotWorkingModal, SpeakerAttributionModal, VoiceSpeakerAttributionModal)
├── versions.json                     # Obsidian version compatibility map
├── docs/                             # Extended architecture and implementation docs
│   ├── ARCHITECTURE.md
│   └── IMPLEMENTATION.md
├── skills/                           # Editable markdown files that define AI behaviour
│   ├── meeting-router.md             # How to classify standup vs. general
│   ├── general-meeting.md            # General meeting workflow
│   ├── standup-meeting.md            # Standup workflow (pre/post-meeting modes)
│   ├── transcript-cleanup.md         # Transcript format details + cleaning rules
│   ├── summary-generation.md         # Summary output format
│   ├── jira-population.md            # JIRA section format + icons
│   ├── attendee-extraction.md        # Screenshot vision + profile creation rules
│   └── email-summary.md              # Email chain summary prompt (discussed/decisions/actions/questions)
└── src/
    ├── copilot-client.ts             # CopilotClientManager — all AI/CLI calls live here
    ├── meeting-router.ts             # MeetingRouter — dispatches to meeting or email handler
    ├── validators.ts                 # validateMeetingFile(), validateEmailNote(), detectMeetingType(), detectTeam()
    ├── email-parser.ts               # parseEmailParticipants() — From/To/Cc header extraction, HPE filter
    ├── skill-loader.ts               # SkillLoader — reads skills/ dir, parses sections
    ├── people-manager.ts             # PeopleManager — create/find People profile notes; createProfileWithBody()
    ├── speaker-resolver.ts           # SpeakerResolver — map [Speaker N] → real names
    ├── output-cleaner.ts             # cleanCopilotOutput() — strip CLI trace artifacts
    ├── voice-analysis-types.ts       # VoiceSpeakerResult, VoiceAnalysisResponse, VoiceNameAssignment
    ├── voice-analysis-client.ts      # VoiceAnalysisClient — HTTP daemon + CLI subprocess fallback
    ├── voice-speaker-resolver.ts     # VoiceSpeakerResolver — shared logic for both handlers
    ├── handlers/
    │   ├── general.ts                # GeneralMeetingHandler — attendees + transcript + summary
    │   ├── standup.ts                # StandupMeetingHandler — JIRA + attendees + summary
    │   └── email.ts                  # EmailChainHandler — participants + summary for email notes
    ├── jira/
    │   ├── api-client.ts             # JiraApiClient — direct REST API, Basic Auth
    │   ├── client.ts                 # JiraIssue type + groupIssuesByAssignee()
    │   ├── extractor.ts              # JiraKeyExtractor — extract keys, update checkboxes
    │   ├── formatter.ts              # JiraFormatter — markdown with icons + status emoji
    │   └── manager.ts                # JiraManager — orchestrates query + format
    ├── transcript/
    │   ├── types.ts                  # TranscriptCleaner interface, SpeakerEntry type
    │   ├── detector.ts               # TranscriptDetector — picks the right cleaner
    │   ├── index.ts                  # Re-exports
    │   ├── cleaner-teams.ts          # TeamsDirectPasteCleaner
    │   ├── cleaner-downloaded.ts     # TeamsDownloadedCleaner
    │   ├── cleaner-docx.ts           # TeamsDocxCleaner
    │   ├── cleaner-google-recorder.ts# GoogleRecorderCleaner
    │   ├── cleaner-macwhisper.ts     # MacWhisperJsonCleaner
    │   ├── cleaner-whisper-file.ts   # WhisperFileMetaCleaner
    │   └── cleaner-simple.ts         # SimpleTranscriptCleaner (always-true fallback)
    ├── ui/
    │   ├── settings-tab.ts           # MeetingProcessorSettings interface + SettingTab
    │   ├── status-bar.ts             # StatusBarManager
    │   ├── copilot-working-modal.ts  # CopilotWorkingModal — spinner + elapsed timer
    │   ├── speaker-attribution-modal.ts      # SpeakerAttributionModal — text-heuristic speaker assign
    │   └── voice-speaker-attribution-modal.ts # VoiceSpeakerAttributionModal — voice-based speaker assign
    └── __tests__/
        ├── fixtures/
        │   ├── daemon-responses.ts   # ALL_AUTO_RESPONSE, MIXED_RESPONSE, ALL_SKIP_RESPONSE fixtures
        │   └── email-chain-sic-issue.md  # Real email chain note used as email-parser test fixture
        ├── helpers/
        │   ├── obsidian-mock.ts      # HTMLElement polyfills for jsdom
        │   └── mock-daemon.ts        # Node http.createServer test helper
        ├── voice-analysis-client.test.ts           # 9 tests for VoiceAnalysisClient
        ├── voice-speaker-attribution-modal.test.ts # 10 tests for VoiceSpeakerAttributionModal
        ├── upsert-summary-section.test.ts           # 7 tests for upsertSummarySection
        ├── email-parser.test.ts                     # 12 tests for email-parser (uses real fixture)
        └── email-handler.test.ts                    # 9 tests for EmailChainHandler section utilities + preserve-existing
```

---

## Key Design Decisions

### 1. Copilot CLI Only (`copilot -p`) — SDK removed
All AI calls use `spawn(cliPath, ['-p', prompt])`. The `@github/copilot-sdk` session
API was removed entirely (it was dead code — `initialize()`/`createSession()` had
no callers because the SDK had stdio/JSON-RPC startup reliability issues in
Electron); the dependency is no longer bundled.

Two CLI call patterns exist in `copilot-client.ts`:
- `sendPrompt()` — general text generation
- `analyzeImageWithCLI()` — vision analysis by embedding `[📷 /abs/path]` in the prompt

### 2. Skills as Editable Markdown
AI behaviour is defined entirely in `skills/*.md` files. `SkillLoader` reads these at plugin startup and injects the relevant skill content into prompts. Skills can be edited without recompiling — changes take effect after reloading Obsidian. This makes the AI layer adjustable by Copilot CLI itself.

### 3. Direct JIRA API (No Copilot for JIRA)
`JiraApiClient` calls the Atlassian Agile REST API directly (`/rest/agile/1.0/board/{id}/sprint`) using Basic Auth. Obsidian's `requestUrl()` is used instead of `fetch` to avoid CORS restrictions in the Electron webview. The Copilot-based JIRA path (`queryJiraWithCLI`) was dead code and has been removed.

### 4. Transcript Detection Order
`TranscriptDetector` maintains a priority-ordered cleaner list. **Order matters**:
1. `WhisperFileMetaCleaner` — JSON where `speaker` is an object
2. `MacWhisperJsonCleaner` — JSON where `speaker` is a string
3. `TeamsDirectPasteCleaner`
4. `TeamsDownloadedCleaner`
5. `TeamsDocxCleaner`
6. `GoogleRecorderCleaner`
7. `SimpleTranscriptCleaner` (always returns `true` from `canHandle`)

WhisperFileMeta must precede MacWhisper because both handle JSON — the metadata format is more specific.

### 5. Concurrent Copilot Call Tracking
`CopilotClientManager` uses a `pendingCalls` counter. `showWorking()` increments it and opens the modal on the first call. `hideWorking()` decrements it and closes the modal only when the counter reaches zero. This keeps the working modal visible across multiple sequential or parallel Copilot calls.

### 6. Voice Speaker Identification (whisper-speaker-id integration)

When a transcript section contains a `![[*.whisper]]` embed, the plugin performs voice-based speaker identification before any text processing:

**Architecture: HTTP daemon + CLI fallback**
- `VoiceAnalysisClient` first attempts HTTP to `http://127.0.0.1:8765` (the `whisper-speaker-id` daemon)
- If the daemon isn't running and `autoStart` is enabled, the plugin spawns it as a detached background process and polls `/health` until ready (up to 60 s)
- If the daemon fails to start, falls back to `whisper-speaker-id analyze --json` CLI subprocess
- All HTTP calls use Node's built-in `http` module (not `fetch`) — this bypasses Electron's Content Security Policy for localhost requests

**Processing order (CRITICAL — must not change):**
1. `peekScreenshotAttendees` — extract attendee names from screenshots (read-only, no note write)
2. `identifyWhisperSpeakers(file, screenshotAttendees)` — voice analysis + modal → writes names to `.whisper` file
3. `processAttendees` — reads updated `.whisper` speakers, merges with screenshots, writes Attendees section
4. `expandTranscriptEmbed` — replaces `![[*.whisper]]` with inline text (embed path LOST after this)
5. `resolveSpeakers` — text heuristics for any remaining `[Speaker N]` labels

**`VoiceSpeakerAttributionModal`:**
- Auto-bypasses entirely if all speakers have `action === "auto"` (score ≥ 0.75)
- Shows three sections: ✓ Auto (collapsible), ❓ Confirm (pre-filled dropdown), 🔍 Unresolved (empty dropdown)
- Dropdown uses `<optgroup>`: *Meeting Attendees* first (from screenshots), then *Other Speakers* (reference library)
- "New name" text input uses `<datalist>` for autocomplete — attendees listed before library speakers
- Auto section shows `👤` badge next to names that are meeting attendees
- Score displayed as percentage badge: green ≥ 75%, orange 50–74%, grey < 50%
- Each row has a "▶ Play" button (only rendered when `whisperPath`/`voiceClient` are provided). On click,
  lazily fetches the speaker's clip via `VoiceAnalysisClient.getSpeakerClip()` (daemon's `POST /extract-clip`,
  cached in the daemon's `~/tmp/wsi-audio-cache/`) and plays it through a single shared `<audio>` element
  (only one clip plays at a time; starting another stops/resets the previous button). Button shows
  "Loading…" while fetching, "⏸ Pause" while playing, and a brief inline error + auto re-enable on failure
  (e.g. daemon down, or 404 if the speaker has no in-bounds segment). No CLI fallback — playback is a
  daemon-only convenience feature.

**`<!-- whisper-source -->` sentinel:**
`expandTranscriptEmbed` prepends this to expanded `.whisper` content. `resolveSpeakers` detects it and skips the text-heuristic modal (speaker names are already resolved). This is correct — voice ID has already handled them.

### 7. Speaker Attribution Modal (text heuristics)
When a transcript contains generic `[Speaker 1]` / `[Speaker 2]` labels (common with some Whisper outputs), `SpeakerResolver` attempts automatic mapping from attendee list + content heuristics. Any unresolved or low-confidence mappings are presented in a modal dialog for user review before the transcript is updated.

This modal is **only shown when voice identification is not available** or when `<!-- whisper-source -->` is absent (i.e. the transcript did not come from a `.whisper` embed).

---

## Settings Schema (`MeetingProcessorSettings`)

| Field | Default | Description |
|-------|---------|-------------|
| `model` | `claude-sonnet-4` | AI model passed to Copilot |
| `copilotCliPath` | `copilot` | Absolute or relative path to `copilot` binary |
| `meetingsFolder` | `Meetings` | Vault folder for meeting notes |
| `dailyNotesFolder` | `Daily Notes` | Vault folder for daily-summary notes |
| `notesFolder` | `Notes` | Vault folder for notes and email chain notes |
| `peopleFolder` | `People` | Vault folder for People profiles |
| `mediaFolder` | `Media` | Vault folder for images/attachments |
| `templatesFolder` | `Templates` | Vault folder for templates |
| `autoCreateProfiles` | `true` | Auto-create People profiles for attendees |
| `autoCleanTranscript` | `true` | Auto-clean transcripts (skipped if Copilot Summary exists) |
| `jiraEmail` | `""` | Atlassian account email for Basic Auth |
| `jiraApiToken` | `""` | Atlassian API token |
| `jiraBaseUrl` | `https://hpe.atlassian.net` | JIRA instance URL |
| `greenBoardId` | `214` | JIRA board ID for Green Team |
| `jiraProjectKey` | `GLCP` | Project key used for test queries |
| `standupKeywords` | `Green Standup` | Comma-separated keywords for standup detection |
| `filenamePattern` | `YYYY-MM-DD - *.md` | Expected filename format (informational) |
| `voiceServiceEnabled` | `true` | Enable voice-based speaker identification |
| `voiceServiceBinaryPath` | `whisper-speaker-id` | Full path to the binary — use `~/git/whisper-speaker-id/.venv/bin/whisper-speaker-id` |
| `voiceServicePort` | `8765` | HTTP port for the daemon |
| `voiceServiceAutoStart` | `true` | Auto-spawn daemon if not running |
| `macWhisperTranscriptsDir` | `~/Documents/Mac Whisper/Meeting Transcripts` | Source dir MacWhisper drops `.whisper` files into; used to auto-locate the matching `.whisper` for a meeting |

---

## Meeting File Requirements

A file is only processed if ALL of these hold:
1. Extension is `.md`
2. Path starts with `{meetingsFolder}/`
3. Filename matches `/^\d{4}-\d{2}-\d{2} - .+\.md$/`
4. Content contains `tags: [meeting]`, `tags:\n  - meeting`, or `tags: meeting`

Meeting type is detected from the filename:
- Contains any keyword from `standupKeywords` → **standup**
- Otherwise → **general**

Team is detected from `file.basename.toLowerCase()`:
- Contains `"green"` → Green Team (board 214)

---

## Email Chain Note Requirements

When "Process Meeting" is invoked on a non-meeting file, the plugin falls back to email chain validation. A file is processed as an email chain if ALL of these hold:
1. Extension is `.md`
2. Path starts with `{notesFolder}/` (default: `Notes/`)
3. Frontmatter contains `tags: note`
4. Content contains a `# Email Chain` section heading

**Template** (`Templates/Email Chain.md`): `# Participants` + `# Summary` + `# Email Chain`

### Email Chain Workflow
1. Parse `From/To/Cc` headers from `# Email Chain` section using `parseEmailParticipants()`
2. Filter to `@hpe.com` addresses only; exclude group mailboxes (no comma in display name)
3. For each participant: look up existing People profile, or create one with Copilot-generated body (role/team inferred from email context)
4. Update `# Participants` section with wiki-links (skipped if already populated)
5. Generate email-specific summary via Copilot using `email-summary` skill: What was discussed / Key decisions / Action items / Open questions
6. Update `# Summary` section (skipped if already populated)

**Preserve-existing behaviour:** Both `# Participants` and `# Summary` are only written if they are currently empty. Re-running on an already-processed note is a no-op.

---

### General Meeting Workflow
1. Pre-extract screenshot attendees (read-only, seeds voice modal candidate list)
2. **Voice speaker identification** — if `.whisper` embed present: call daemon or CLI, show `VoiceSpeakerAttributionModal`, write names to `.whisper`
3. Extract attendees (vision from `![[SCR-*.png]]` images, merge `.whisper` speakers, or content scan)
4. Create/link People profiles for each attendee
5. Update `## Attendees` section with wiki-links
6. Expand `![[*.whisper]]` embed to inline transcript
7. Clean transcript (skip if `## Copilot Summary` already has content)
8. Generate AI summary → insert into `## Summary` section

### Standup — Pre-Meeting Mode (transcript section empty / < 50 chars)
1. Query JIRA: active sprint issues for the team's board
2. Group by assignee, format with icons + status emoji
3. Insert formatted `## JIRA` section into the note
4. Populate expected attendees

### Standup — Post-Meeting Mode (transcript section has content)
1. Pre-extract screenshot attendees (read-only, seeds voice modal candidate list)
2. **Voice speaker identification** — if `.whisper` embed present: call daemon or CLI, show modal, write names to `.whisper`
3. Process attendees (screenshots first, then `.whisper` speakers merged in)
4. Expand `![[*.whisper]]` embed to inline transcript
5. Resolve speaker labels (`[Speaker N]` → real names via text heuristics, only if needed)
6. Clean transcript (skip if `## Copilot Summary` exists)
7. Generate summary
8. Extract JIRA keys mentioned in transcript/summary
9. Check boxes for mentioned keys in `## JIRA` section
10. Append context notes to checked items

---

## Build System

```bash
npm run dev      # esbuild watch mode (inline sourcemaps)
npm run build    # Production build (no sourcemaps, tree-shaking, exits)
```

esbuild config:
- Entry: `main.ts` → `main.js`
- Format: CJS (required by Obsidian)
- Target: ES2020
- External: `obsidian`, `electron`, all CodeMirror/Lezer packages, Node builtins
- Bundled: `jszip`, `mammoth`

After a build, reload Obsidian with `Cmd+R` (or "Reload app without saving" from command palette) — no full restart required.

---

## Development Deployment

The plugin is deployed via symlink:
```bash
ln -s ~/git/obsidean-meeting ~/path/to/vault/.obsidian/plugins/obsidean-meeting
```

This means the running plugin IS the repository. No copy step needed. The symlink was created on 2025-02-05.

---

## Testing

### Jest unit tests (47 tests)

```bash
cd ~/git/obsidean-meeting
npm test
```

Tests cover:
- `VoiceAnalysisClient` — HTTP daemon calls, CLI fallback, spawn error handling (9 tests)
- `VoiceSpeakerAttributionModal` — auto-bypass, apply/close, dropdown optgroups, datalist ordering, attendee badge (10 tests)
- `upsertSummarySection` — last section, middle section, insert-before-Notes, append, no-duplicate (7 tests)
- `email-parser` — HPE filtering, deduplication, group exclusion, name format, real fixture (12 tests)
- `EmailChainHandler` — section utilities (extract/isEmpty/replace), preserve-existing logic (9 tests)

**Jest environment notes:**
- Modal tests require `@jest-environment jsdom` docblock
- `obsidian-mock.ts` polyfills `HTMLElement.prototype.createEl/createDiv/empty/addClass` for jsdom
- `mock-daemon.ts` uses real `http.createServer` and converts camelCase to snake_case wire format

### Manual testing workflow
1. Open a meeting note in Obsidian that matches the file requirements
2. Click the brain-circuit ribbon icon or run "Process Meeting" from command palette
3. If a `.whisper` embed is present, the voice speaker modal should appear (or auto-bypass)
4. Observe the `CopilotWorkingModal` (spinner + elapsed timer)
5. Verify the correct sections are populated/updated in the note
6. Check Obsidian developer console (`Cmd+Option+I`) for logs and errors

For email chain notes:
1. Open a note in `Notes/` with `tags: note` and a `# Email Chain` section
2. Run "Process Meeting" — it auto-detects the email chain format
3. `# Participants` will be populated with wiki-linked HPE participants
4. `# Summary` will be populated with Copilot-generated email summary

---

## Common Issues & Fixes

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| "Copilot CLI not found" | Wrong `copilotCliPath` | Set full path in settings: `which copilot` |
| JIRA section not populating | Missing credentials | Add email + API token in settings |
| Transcript not cleaned | `## Copilot Summary` already has content | Expected — by design, existing summary is preserved |
| Vision extraction fails | Image path not found in vault | Verify `![[SCR-...]]` reference and media folder |
| `[Speaker N]` in transcript | Whisper-generated transcript | Speaker attribution modal will appear for manual mapping |
| Modal stays open indefinitely | Copilot CLI process hung | Force-quit Obsidian; check CLI auth with `copilot auth status` |
| "Voice service unavailable" | Daemon not running or binary path wrong | Check Settings → Voice Service binary path; use full venv path `~/git/whisper-speaker-id/.venv/bin/whisper-speaker-id` |
| Daemon won't start | `omegaconf` missing | Run: `cd ~/git/whisper-speaker-id && .venv/bin/pip install omegaconf` |
| Voice modal has no attendee names | Screenshot extraction hasn't run yet | Should not happen — `peekScreenshotAttendees` runs before voice analysis |
| Voice analysis very slow | Model loading on first call | Normal — pyannote embedding model takes 10–30 s to load; subsequent calls are fast |
| Email note: "Cannot process this file" | File missing `# Email Chain` section or wrong folder | Note must be in `Notes/` folder, have `tags: note`, and contain `# Email Chain` |
| Email: only some participants found | Group mailboxes excluded by design | Only HPE addresses with "Last, First" comma format are included; groups are excluded |
| Email: `# Participants` not updated | Section already has content | Preserve-existing: section is only written if empty; delete content to re-run |

---

## External Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `jszip` | ^3.10.1 | Parse `.docx` files (DOCX transcript cleaner) |
| `mammoth` | ^1.11.0 | Extract text from `.docx` files |
| `obsidian` | latest | Obsidian API types (devDependency; provided at runtime) |
| `esbuild` | ^0.19.10 | Bundler (devDependency) |
| `typescript` | ^5.3.3 | Compiler (devDependency) |
