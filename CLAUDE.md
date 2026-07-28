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
│   ├── REFERENCE.md                  # Single-source architecture/workflow/format reference (start here)
│   ├── ARCHITECTURE.md
│   ├── IMPLEMENTATION.md
│   └── legacy-skills/                # 6 unused skill files, relabeled + not loaded (kept for reference)
├── skills/                           # Editable markdown files that define AI behaviour (only 3 are loaded)
│   ├── summary-generation.md         # Summary output format (used by general + standup meetings)
│   ├── email-summary.md              # Email chain summary prompt (discussed/decisions/actions/questions)
│   └── daily-summary.md              # Daily note summary prompt
└── src/
    ├── copilot-client.ts             # CopilotClientManager — all AI/CLI calls live here
    ├── meeting-router.ts             # MeetingRouter — dispatches to meeting or email handler
    ├── validators.ts                 # validateMeetingFile(), validateEmailNote(), detectMeetingType(), detectTeam()
    ├── email-parser.ts               # parseEmailParticipants() — From/To/Cc header extraction, HPE filter
    ├── section-utils.ts              # getSection/isSectionEmpty/replaceSection/upsertSection — shared heading-level-tolerant section utility
    ├── skill-loader.ts               # SkillLoader — reads skills/ dir (3 active skills only), parses sections
    ├── people-manager.ts             # PeopleManager — create/find People profile notes; createProfileWithBody()
    ├── speaker-resolver.ts           # SpeakerResolver — map [Speaker N] → real names
    ├── output-cleaner.ts             # cleanCopilotOutput() — strip CLI trace artifacts
    ├── voice-analysis-types.ts       # VoiceSpeakerResult, VoiceAnalysisResponse, VoiceNameAssignment
    ├── voice-analysis-client.ts      # VoiceAnalysisClient — HTTP daemon + CLI subprocess fallback
    ├── voice-speaker-resolver.ts     # VoiceSpeakerResolver — shared logic for both handlers
    ├── handlers/
    │   ├── base-meeting-handler.ts   # BaseMeetingHandler — shared attendee/transcript/speaker/summary pipeline (~85% of general+standup logic)
    │   ├── general.ts                # GeneralMeetingHandler — thin subclass of BaseMeetingHandler (103 lines)
    │   ├── standup.ts                # StandupMeetingHandler — subclass of BaseMeetingHandler + JIRA pre/post logic (418 lines)
    │   ├── email.ts                  # EmailChainHandler — participants + summary for email notes
    │   └── daily-summary.ts          # DailySummaryHandler — aggregates linked meetings/notes into a daily `## Daily Summary`
    ├── jira/
    │   ├── cli-client.ts              # JiraCliClient — preferred path via `jira` CLI (--raw JSON)
    │   ├── shell-env-token.ts         # resolveJiraApiToken — settings -> process.env -> shell capture
    │   ├── api-client.ts              # JiraApiClient — direct REST API fallback, Basic Auth
    │   ├── client.ts                  # JiraIssue type + groupIssuesByAssignee()
    │   ├── extractor.ts               # JiraKeyExtractor — extract keys, update checkboxes
    │   ├── formatter.ts                # JiraFormatter — markdown with icons + status emoji + a "**Key:**" legend line
    │   └── manager.ts                 # JiraManager — tries CLI first, falls back to REST, formats
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
        ├── voice-analysis-client.test.ts           # 15 tests for VoiceAnalysisClient (incl. forgetSpeaker HTTP/CLI fallback)
        ├── voice-speaker-attribution-modal.test.ts # 25 tests for VoiceSpeakerAttributionModal (incl. audio playback, correctable Auto rows, Skip/Clear-voice-cache checkboxes)
        ├── whisper-source-sentinel.test.ts          # 8 tests: <!-- whisper-source --> sentinel add/check/strip, shared by general + standup handlers
        ├── upsert-summary-section.test.ts           # 7 tests for upsertSummarySection
        ├── email-parser.test.ts                     # 13 tests for email-parser (uses real fixture)
        ├── email-handler.test.ts                    # 8 tests for EmailChainHandler section utilities + preserve-existing
        └── daily-summary-handler.test.ts             # 21 tests for DailySummaryHandler (section utils, file discovery, summary extraction)
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

### 3. JIRA: CLI-First with REST Fallback (No Copilot for JIRA)
`JiraManager.queryAndFormatSprint()` prefers `JiraCliClient` (`src/jira/cli-client.ts`),
which spawns the `jira` CLI (`ankitpokhrel/jira-cli`) as a child process: 
`jira issue list -q "sprint in (<id>)" --raw` — but *not* before first resolving the
actual active sprint id via `jira sprint list --state active --plain --no-headers
--columns ID,NAME,STATE`. An earlier version queried
`project = <KEY> AND sprint in openSprints()` directly, which is unscoped to any
particular board/team and returns every open sprint across the *entire* Jira project
(every team sharing that project) — surfaced as "JIRA CLI works now, but shows other
teams' issues instead of mine". Since `jira-cli` has no `--board` flag, board scoping
comes entirely from whatever `board.id` is configured in the user's own `jira init`
config (`~/.config/.jira/.config.yml`), which is why the sprint id must be resolved
via that config-scoped `sprint list` call first.

Auth for the CLI comes from `JIRA_API_TOKEN`, resolved by `src/jira/shell-env-token.ts`
(`resolveJiraApiToken`) in priority order: `process.env.JIRA_API_TOKEN` (already
inherited) → a shell-captured value → `settings.jiraApiToken` as a last resort. The
shell capture spawns the user's real login shell (`$SHELL -ilc 'printf "%s" "$JIRA_API_TOKEN"'`)
because Obsidian, launched via Launchpad/Spotlight, is a `launchd` GUI-session child and
never inherits variables exported only in `~/.zshrc` — the same technique VS Code's
`resolveShellEnv` and the `shell-env` npm package use to solve this exact class of problem.
The resolved value is cached in-memory for the plugin's lifetime (see
`resetShellEnvTokenCache()` for tests) so a login shell isn't re-spawned per query.
**`settings.jiraApiToken` is deliberately checked last**, not first: it's the same field
used by the REST fallback's Basic Auth and can go stale independently (an expired
Atlassian API token saved in plugin settings) — if it were checked first it would
silently shadow a working shell-captured token, and the CLI would authenticate with the
wrong/expired credential and return an empty result set (`jira-cli` reports this as
`✗ No result found for given query...`, not as an auth error) instead of using the
value that actually works.

On any CLI failure — binary not found (`ENOENT`), non-zero exit (e.g. a `401`), timeout, or
malformed JSON, all surfaced as a `JiraCliError` — `JiraManager` logs a warning and falls
back to the original `JiraApiClient` (`src/jira/api-client.ts`), which calls the Atlassian
Agile REST API directly (`/rest/agile/1.0/board/{id}/sprint`) using Basic Auth via
`settings.jiraEmail`/`settings.jiraApiToken`. Obsidian's `requestUrl()` is used instead of
`fetch` to avoid CORS restrictions in the Electron webview. If *both* paths fail, the
pre-existing `⚠️ Error querying JIRA...` string is written into the note as before. The
Copilot-based JIRA path (`queryJiraWithCLI`) was unrelated dead code and has been removed
(not to be confused with the new `jira`-CLI-based `JiraCliClient`).

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
- Auto-bypasses entirely if all speakers have `action === "auto"` (score ≥ 0.75) — this full-auto
  silent bypass is intentional and unchanged; if a modal *does* open, every row it renders is correctable.
- Shows three sections: ✓ Auto, ❓ Confirm (pre-filled dropdown), 🔍 Unresolved (empty dropdown)
- **Auto rows are correctable, not read-only**: they render the same dropdown (`buildDropdown`)
  + "type a new name" input (`renderNewNameInput`) as Confirm/Unresolved rows, preselected to
  `bestMatch`. If the voice-ID match is wrong (e.g. auto-identified as "Shaji Mohammed" when it
  shouldn't have been), the user can pick a different attendee/library speaker or type a new name
  before clicking Apply. `applyAndClose()` reads every speaker's final name uniformly from
  `this.pending` (seeded with `bestMatch` for auto speakers) — there is no special-cased
  auto-always-wins branch.
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
- **"Skip" + "Clear voice cache" checkboxes** on Auto and Confirm rows, next to the name dropdown
  (replaces the earlier 🗑 wipe button design):
  - **Skip** (always rendered): checking it disables the row's `<select>`/"type a new name" `<input>`
    and forces that speaker's final assignment to skip, regardless of whatever name was previously
    selected/typed. Unchecking re-enables the controls and restores the row's assignment from the
    dropdown's current value.
  - **Clear voice cache** (only rendered when a voice client is available): a destructive,
    library-wide action — checking it does not just fix the current meeting's mismatch, it marks
    **all** stored voice samples for that row's name for deletion from the `whisper-speaker-id`
    reference library. **Gated by Skip, not mutually exclusive with it**: this checkbox starts
    disabled/unchecked on every row; checking Skip enables it (still unchecked — opt-in, not
    automatic); it cannot be checked while Skip is unchecked; unchecking Skip disables **and**
    unchecks it again. You can check Skip alone for a plain skip with no wipe.
  - **Deferred/batched execution**: nothing is deleted when a checkbox is checked. Both **Apply**
    and **Skip All** route through `finishWithWipes()`, which collects every row with "Clear voice
    cache" checked (reading the name from `lastAssignedName`, not `pending` — since `pending` is
    forced to `''` once Skip is checked), and if any are pending, shows **one** combined
    `window.confirm()` listing every name to be deleted. On confirm: calls
    `VoiceAnalysisClient.forgetSpeaker(name)` for each (HTTP `DELETE /speakers/{name}` on the
    daemon, falling back to the `forget-speaker` CLI command), shows a summary `Notice`, removes
    each wiped name from the in-session `knownSpeakers` list, and resets every row currently
    assigned to that name (`pending` + its `<select>`/`<input>`) back to blank. **Cancelling the
    combined confirm aborts the entire Apply/Skip-All action** — nothing is deleted and the modal
    stays open, letting the user reconsider.
  - Requires the `whisper-speaker-id` daemon to be updated to a version with the
    `DELETE /speakers/{name}` endpoint / `forget-speaker` CLI command to take effect.
- **Sample-quote/audio alignment**: the italic transcript excerpt shown per row
  (`extractWhisperSampleQuotes()` in `src/transcript/whisper-sample-quotes.ts`) selects each
  speaker's representative segment by **duration** (mirroring the daemon's
  `longest_segment_by_speaker`/`best_segment_for_playback` in `whisper_file.py`, including its
  ms-vs-seconds timestamp normalization), not by text length as before — so the quote shown
  matches what's actually heard via the ▶ Play button in the vast majority of cases. Trivial/
  near-empty segments are still excluded regardless of duration; ties are broken by longer text.
  Known limitation: the daemon additionally bounds candidates to the real audio duration as a
  defense against corrupted timestamp units — the TS-side extractor has no access to the audio
  track's real length (it only reads `metadata.json`) and can't replicate that bounds check, so a
  `.whisper` file with such corrupted timestamps could still show a mismatched quote in rare cases.

**`<!-- whisper-source -->` sentinel:**
`expandTranscriptEmbed` prepends this to expanded `.whisper` content. `resolveSpeakers` detects it and skips the text-heuristic modal (speaker names are already resolved). This is correct — voice ID has already handled them. `cleanTranscript` also detects it and **skips re-cleaning entirely** — `expandTranscriptEmbed` already ran the correct cleaner (e.g. `MacWhisperJsonCleaner`) on this content before prepending the sentinel, so it's already in final form. This guard was added after a bug where `cleanTranscript` re-ran `TranscriptDetector.detectAndClean()` on the already-clean, sentinel-prefixed text; `GoogleRecorderCleaner.canHandle()` (which matches any `[text]` on its own line) false-positively matched it, and its `clean()` treats any content before the first `[Speaker]` line as "preamble" that gets merged into the first speaker's utterance — corrupting the transcript into `[Name]\n<!-- whisper-source --> First words...` instead of leaving the sentinel on its own line. Once `cleanTranscript` confirms the skip, it also **strips the sentinel line from the note** (via `replaceSection`) — the comment has by then served its purpose for both `resolveSpeakers` and `cleanTranscript`, and is no longer left visible in the final transcript.


This sentinel add/check logic (`transformExpandedTranscript()` / `shouldSkipSpeakerResolution()`) lives
as the **default implementation in `BaseMeetingHandler`**, not in `StandupMeetingHandler` — it is
meeting-type-agnostic (it only cares whether the transcript came from a `.whisper` embed voice ID had a
chance to process, not standup vs. general), so both `GeneralMeetingHandler` and
`StandupMeetingHandler` inherit it automatically. (Previously this was only implemented in
`StandupMeetingHandler`, which meant general meetings incorrectly reopened the text-heuristic
`SpeakerAttributionModal` right after the voice-ID modal was skipped/closed — fixed by moving the
defaults up to the base class.)

### 7. Speaker Attribution Modal (text heuristics)
When a transcript contains generic `[Speaker 1]` / `[Speaker 2]` labels (common with some Whisper outputs), `SpeakerResolver` attempts automatic mapping from attendee list + content heuristics. Any unresolved or low-confidence mappings are presented in a modal dialog for user review before the transcript is updated.

This modal is **only shown when voice identification is not available** or when `<!-- whisper-source -->` is absent (i.e. the transcript did not come from a `.whisper` embed).

---

## Settings Schema (`MeetingProcessorSettings`)

| Field | Default | Description |
|-------|---------|-------------|
| `model` | `auto` | AI model, passed as `copilot --model <value>` |
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
| `jiraApiToken` | `""` | Atlassian API token (REST fallback auth; NOT used by the CLI path, which reads `JIRA_API_TOKEN` from the environment/shell) |
| `jiraCliEnabled` | `true` | Prefer the `jira` CLI over direct REST for sprint queries |
| `jiraCliPath` | `jira` | Path to the `jira` CLI executable |
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

### General Meeting Workflow (`GeneralMeetingHandler`, inherits from `BaseMeetingHandler`)
1. Extract attendees (vision from `![[SCR-*.png]]` images, or content scan)
2. Create/link People profiles for each attendee
3. Update `# Attendees` section with wiki-links
4. **Voice speaker identification** — if `.whisper` embed/auto-found file present and `voiceServiceEnabled`: call daemon or CLI, show `VoiceSpeakerAttributionModal`, write names to `.whisper`
5. Expand `![[*.whisper]]` embed (or auto-found MacWhisper file matched by meeting name) to inline transcript
6. Resolve speaker labels (`[Speaker N]` → real names via text heuristics, skipped if `<!-- whisper-source -->` sentinel present)
7. Clean transcript (skip if `# Copilot Summary` already has content)
8. Generate AI summary → insert into `# Summary` section

### Standup — Pre-Meeting Mode (transcript section empty / < 50 chars)
1. Query JIRA: active sprint issues for the team's board
2. Group by assignee, format with icons + status emoji
3. Insert/replace formatted `# JIRA` section into the note (after `# Attendees`, else after frontmatter, else at top)

### Standup — Post-Meeting Mode (transcript section has content), inherits from `BaseMeetingHandler`
1. Pre-extract screenshot attendees (read-only, seeds voice modal candidate list)
2. **Voice speaker identification** — if `.whisper` embed present and `voiceServiceEnabled`: call daemon or CLI, show modal, write names to `.whisper`
3. Process attendees (screenshots first, then `.whisper` speakers merged in)
4. Expand `![[*.whisper]]` embed to inline transcript
5. Resolve speaker labels (`[Speaker N]` → real names via text heuristics, skipped if `.whisper`-sourced)
6. Clean transcript (skip if `# Copilot Summary` exists)
7. Generate summary
8. Extract JIRA keys mentioned in transcript/summary
9. Check boxes for mentioned keys in `# JIRA` section
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

### Jest unit tests (179 tests)

```bash
cd ~/git/obsidean-meeting
npm test
```

Tests cover:
- `VoiceAnalysisClient` — HTTP daemon calls, CLI fallback, spawn error handling, `forgetSpeaker` HTTP/CLI fallback (15 tests)
- `VoiceSpeakerAttributionModal` — auto-bypass, apply/close, dropdown optgroups, datalist ordering, attendee badge, audio playback, correctable Auto rows, Skip/Clear-voice-cache checkboxes with batched wipe-on-Apply/Skip-All (25 tests)
- `whisper-source-sentinel` — `<!-- whisper-source -->` add/check/strip shared by `BaseMeetingHandler`, exercised via both general and standup handlers, incl. `cleanTranscript` skip-re-clean-and-strip regression (10 tests)
- `upsertSummarySection` — last section, middle section, insert-before-Notes, append, no-duplicate (7 tests)
- `email-parser` — HPE filtering, deduplication, group exclusion, name format, real fixture (13 tests)
- `EmailChainHandler` — section utilities (extract/isEmpty/replace), preserve-existing logic (8 tests)
- `DailySummaryHandler` — section utilities, linked-file discovery, summary extraction fallback chain (21 tests)
- `jira-shell-env-token` — token resolution priority (settings → `process.env` → shell capture), caching, timeout guard (9 tests)
- `jira-cli-client` — `jira issue list --raw` JSON parsing, ENOENT/non-zero-exit/timeout/bad-JSON error paths (9 tests)
- `jira-manager-fallback` — CLI-first ordering, fallback to REST on CLI failure, final error string preserved (5 tests)
- `jira-formatter` — legend line present with all icon/emoji meanings, placed above assignee groups, doesn't collide with checkbox-extractor regex (2 tests)

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
| JIRA section not populating | Missing credentials (CLI and REST) | For CLI path: run `jira issue list` in a terminal to confirm `jira-cli` auth works and `JIRA_API_TOKEN` is exported in your shell rc file; for REST fallback: add email + API token in settings |
| JIRA `401 Unauthorized` (REST) even though `jira` CLI works in terminal | `jiraCliEnabled` disabled, or CLI failed and fell back to REST with stale/empty `jiraEmail`/`jiraApiToken` | Enable `jiraCliEnabled` (default on) and verify `jiraCliPath`; check console for the CLI failure reason logged before the REST fallback attempt |
| Transcript not cleaned | `# Copilot Summary` already has content | Expected — by design, existing summary is preserved |
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
