# Meeting Processor — Comprehensive Reference

> Single-source reference for the `obsidean-meeting` Obsidian plugin and its
> `whisper-speaker-id` voice daemon. Covers architecture, design, implementation,
> the end-to-end user workflow, every supported input format, and exactly what the
> plugin writes back to your notes.
>
> Companion docs: [`ARCHITECTURE.md`](./ARCHITECTURE.md) and
> [`IMPLEMENTATION.md`](./IMPLEMENTATION.md) (older, narrower). This file supersedes
> the overlapping parts of both and of the root `README.md`.
>
> Last verified against source: **2026-07-23** (plugin `main.ts`/`src/**`, daemon
> `whisper_speaker_id/**` v0.3.0). A companion *refinement analysis* (dead code,
> stale docs, high-use areas) lives in
> `~/Documents/copilot/reports/obsidean-meeting-refinement-2026-07-23.md`.

---

## 1. What the system is

Two cooperating components:

| Component | Repo | Language | Role |
|-----------|------|----------|------|
| **Meeting Processor plugin** | `obsidean-meeting` | TypeScript → CJS (esbuild) | Obsidian plugin. One-click processing of meeting notes, standups, email chains, and daily notes. |
| **whisper-speaker-id daemon** | `whisper-speaker-id` | Python 3.11+ (FastAPI) | Optional voice fingerprinting service. Identifies speakers in MacWhisper `.whisper` recordings by matching voice embeddings against a personal reference library. |

The plugin runs entirely inside Obsidian's Electron renderer. It shells out to two
external processes:

- **GitHub Copilot CLI** (`copilot -p <prompt>`) — all AI text/vision generation.
- **whisper-speaker-id** — spawned as a detached HTTP daemon (or one-shot CLI fallback) for voice ID.

JIRA is reached preferentially via the `jira` CLI (spawned like the other CLIs
below, auth token resolved from settings/env/shell), falling back to its direct
REST API (no AI, no MCP) using Obsidian's `requestUrl()`.

```
                    ┌────────────────────────── Obsidian (Electron) ──────────────────────────┐
                    │  main.ts  →  validators  →  MeetingRouter  →  handler (general/standup/    │
                    │                                                 email/daily-summary)       │
                    │                     │                │                 │                   │
                    │             CopilotClientManager  JiraApiClient   VoiceSpeakerResolver     │
                    └─────────┬───────────────────┬───────────────┬───────────────┬─────────────┘
                              │ spawn copilot -p   │ requestUrl     │ http 127.0.0.1:8765
                              ▼                    ▼                ▼
                     GitHub Copilot CLI     Atlassian REST    whisper-speaker-id daemon
                                                              (pyannote embeddings + ffmpeg)
```

---

## 2. Entry point & dispatch

`main.ts` (`MeetingProcessorPlugin`) registers:

- a ribbon icon (`brain-circuit`) and a command palette action, both → `processMeeting()`;
- the settings tab;
- a `StatusBarManager`, `CopilotClientManager`, `SkillLoader`, and `MeetingRouter`.

`processMeeting()` guards against re-entrancy (`this.processing`), grabs the active
file, and **validates it against three profiles in order** (first match wins):

1. **Daily note** → `router.processDailySummary(file)`
2. **Meeting** → `router.process(file)` (standup vs general decided downstream)
3. **Email chain** → `router.processEmail(file)`

If none match, a `Notice` reports why each profile rejected the file.

`MeetingRouter.process()` calls `detectMeetingType()`; a filename containing any
configured standup keyword routes to `StandupMeetingHandler`, otherwise
`GeneralMeetingHandler`.

---

## 3. File requirements (what the plugin will accept)

All matching logic lives in `src/validators.ts`.

### 3.1 Meeting note
Processed only if **all** hold:
1. Extension `.md`.
2. Path starts with `{meetingsFolder}/` (default `Meetings/`).
3. Filename matches `^\d{4}-\d{2}-\d{2} - .+\.md$` → `YYYY-MM-DD - <name>.md`.
4. Content contains a meeting tag: `tags: [meeting]`, `tags:\n  - meeting`, or `tags: meeting`.

**Meeting type** (`detectMeetingType`): filename contains a `standupKeywords` entry
(default `Green Standup`) → **standup**, else **general**.
**Team** (`detectTeam`): lowercased basename contains `green` → Green (board `214`).
A standup without it throws.

### 3.2 Daily note
1. `.md`.
2. Path starts with `{dailyNotesFolder}/` (default `Daily Notes/`).
3. Filename matches `^\d{4}-\d{2}-\d{2}\.md$` exactly.

### 3.3 Email chain note
1. `.md`.
2. Path starts with `{notesFolder}/` (default `Notes/`).
3. Note tag present (`tags: [note]` / `tags:\n  - note` / `tags: note`).
4. Contains a `# Email Chain` heading.

---

## 4. Supported input/metadata formats

### 4.1 Attendee sources
| Source | Detection | How it's read |
|--------|-----------|---------------|
| **Teams screenshots** (preferred) | `![[SCR-*.png]]` embeds | Each image path is resolved to an absolute path and sent to Copilot CLI vision (`analyzeImageWithCLI`), which returns a comma-separated name list. `parseScreenshotNames()` also detects and re-pairs a `"Last, First, Last, First, …"` response shape (an even count of single-word comma-separated tokens) into `"First Last"` names before filtering — some vision responses return this pair form instead of the requested `"First Last"` format, which previously caused 0 attendees to be extracted. **Multiple screenshots** in the Attendees section are all processed (`extractFromScreenshots` loops every `![[SCR-*.png]]` embed found), with names deduped across all of them via a `Set`. Screenshots are considered even when the section **already has wiki-linked attendees** (large meetings often get a screenshot added later) — `processAttendees()` only skips outright when there are no screenshots *and* wiki-links already exist. Newly extracted names are merged (deduped case-insensitively via `dedupeNames()`/`extractExistingAttendeeNames()`) with whatever is already wiki-linked, never replacing it. Once merged in, each processed screenshot's underlying attachment file is deleted from the vault (`deleteScreenshotFiles()`). |
| **`.whisper` speakers array** | present when a recording is matched | After voice ID, the real names in `metadata.json → speakers[]` are merged into the attendee list (standup handler `extractWhisperSpeakers`). |
| **Content scan** (fallback) | no screenshots | Copilot extracts likely names from note body; filtered by `isValidPersonName`. |
| **Email headers** (email chains only) | `From/To/Cc` lines | `email-parser.ts` — see §7. |

Names are validated by `isValidPersonName()` (letters/spaces/hyphens/apostrophes/commas
only; rejects wiki-link fragments, JIRA keys, sentences, generic `Speaker N`).

### 4.2 Recording / transcript formats
The **transcript** can be inline text or an embed inside the `# Transcript` section, or
an auto-discovered `.whisper` file. `TranscriptDetector` (`src/transcript/detector.ts`)
tries cleaners **in priority order** (first `canHandle` wins); `SimpleTranscriptCleaner`
is the always-true fallback.

| # | Cleaner (`getName()`) | Recognised by | Notes |
|---|-----------------------|---------------|-------|
| 7 | `WhisperFileMetaCleaner` — *MacWhisper .whisper File (Format 7)* | JSON object with `transcripts[]` where `speaker` is an **object** `{id,name,color}` | Resolves segment `speaker.id` → real name via top-level `speakers[]`; merges consecutive same-speaker turns; never merges `Unknown`. |
| 6 | `MacWhisperJsonCleaner` — *MacWhisper JSON (Format 6)* | JSON **array** where `speaker` is a **string** | Emits `[Speaker]\n text` blocks; generic `Speaker N` triggers the text attribution modal. |
| 1 | `TeamsDirectPasteCleaner` — *Teams Direct Paste (Format 1)* | Teams URL `→ https://teams.microsoft.com` + `HH:MM:SS AM/PM` | Strips timestamps + profile URLs. |
| 2 | `TeamsDownloadedCleaner` — *Teams Downloaded (Format 2)* | `**Speaker** HH:MM AM` (bold + short timestamp) | Strips bold + timestamps. |
| 3 | `TeamsDocxCleaner` — *Teams .docx Export (Format 3)* | `HH:MM AM` timestamps, leading whitespace, **no** Teams URL/bold | For `.docx` text extracted via `mammoth`/`jszip`. |
| 5 | `GoogleRecorderCleaner` — *Google Recorder (Format 5)* | any `[label]` on its own line | Google Recorder speaker style. |
| 4 | `SimpleTranscriptCleaner` — *Simple/Generic (Format 4)* | always `true` | Generic timestamp/whitespace cleanup fallback. |

> Ordering rationale: the two JSON formats are most specific and must precede the
> text cleaners; the `.whisper` (object-speaker) format must precede the flat JSON
> (string-speaker) format.

### 4.3 The `.whisper` file (MacWhisper package)
A ZIP archive containing:
- `metadata.json` — speakers + transcript segments;
- one embedded audio entry (e.g. `originalAudio`, usually M4A/AAC).

`metadata.json` shape (per daemon `whisper_file.py` and both JSON cleaners):
```json
{
  "transcripts": [                      // NOTE: plural (fallback: "transcript")
    { "text": "…", "start": 1280, "end": 2400,   // ms
      "speaker": { "id": "UUID", "name": "Speaker 1", "color": 0 } }
  ],
  "speakers": [ { "id": "UUID", "name": "Kevin Tronkowski", "color": 1 } ]
}
```
Timestamps are **milliseconds** (heuristic `_ms_to_sec`: value > 10 000 ⇒ ms/1000, else
treated as seconds). `speaker` is a **dict**, not a bare string.

### 4.4 Embed / path resolution for recordings
`expandTranscriptEmbed` treats the `# Transcript` body as an embed when it's short
(< 300 chars) and mentions `![[`, `.txt`, `.docx`, `.json`, or `.whisper`.
`VoiceSpeakerResolver.resolveWhisperForMeeting` locates the `.whisper` file in priority:
1. `{macWhisperTranscriptsDir}/{meeting basename}.whisper`
2. `{macWhisperTranscriptsDir}/{embed filename}`
3. vault paths (`<name>`, `Media/<name>`, `Attachments/<name>`) → absolute path via the vault adapter.

The MacWhisper directory is preferred because those files carry the *latest* speaker
names; vault copies may be stale.

---

## 5. Section-heading contract (what the plugin reads & writes)

**The plugin uses level-1 (`#`) headings**, extracted/replaced via the shared
`src/section-utils.ts` utility (`getSection`/`isSectionEmpty`/`replaceSection`/
`upsertSection`) rather than ad-hoc regexes duplicated per-handler. (Note: the
root README and several `docs/legacy-skills/*.md` still say `##` in places —
that is stale; the code is authoritative.)

| Heading | Read | Written | Notes |
|---------|------|---------|-------|
| `# Attendees` | ✓ | ✓ | Body replaced; names written under a `## In Meeting (N)` sub-list of wiki-links. |
| `# Transcript` | ✓ | ✓ | Embeds expanded/cleaned to inline text in place; created if absent when a `.whisper` is auto-found. |
| `# Copilot Summary` | ✓ | ✗ | Teams-provided AI summary. Presence (≥ 50 real chars after stripping the "AI-generated content…" disclaimer) **suppresses** transcript cleaning. |
| `# Summary` | ✓ | ✓ | Plugin's generated summary. Replaced in place; else inserted before `# Notes`; else appended. |
| `# JIRA` | ✓ | ✓ | Standups only. Replaced if present, else inserted after `# Attendees`/frontmatter. |
| `# Notes` | ✓ | ✗ | Used only as an insertion anchor for `# Summary`. |

Email-chain notes use `# Participants`, `# Summary`, `# Email Chain`.
Daily notes use level-2 `## Daily Summary` and `## Short Conversations and Notes`.

---

## 6. Meeting workflows (step-by-step)

`GeneralMeetingHandler` and `StandupMeetingHandler` both extend
`BaseMeetingHandler` (`src/handlers/base-meeting-handler.ts`), which owns the
shared attendee/transcript/speaker/summary pipeline. Method names below
(`processAttendees`, `expandTranscriptEmbed`, `resolveSpeakers`,
`cleanTranscript`, `generateSummary`, etc.) live in the base class unless
noted otherwise; each subclass only adds its own `process()` orchestration
plus a small set of template-method hook overrides for behavior that
genuinely differs (MacWhisper-filename fallback and voice-library candidates
for general meetings; `.whisper`-sentinel skip and whisper-attendee merge for
standups).

### 6.1 General meeting (`GeneralMeetingHandler.process`)
1. Read note; record whether a real `# Copilot Summary` exists.
2. **Attendees** (`processAttendees`): screenshots → vision; else content scan.
3. **Voice ID** (if `voiceServiceEnabled`): `VoiceSpeakerResolver.identifyWhisperSpeakers` — see §8. Runs *before* the embed is expanded.
4. **Expand transcript** (`expandTranscriptEmbed`): resolve embed / auto-found `.whisper` → cleaned inline text.
5. **Resolve speakers** (`resolveSpeakers`): map residual `[Speaker N]` → real names (text heuristics + modal). Skipped when a `<!-- whisper-source -->` sentinel indicates voice ID already resolved names.
6. **Clean transcript** (`cleanTranscript`) — only if no `# Copilot Summary` and `autoCleanTranscript`. Also skipped (independently of the summary check) when the `<!-- whisper-source -->` sentinel is present — `expandTranscriptEmbed` already ran the correct cleaner on this content before prepending the sentinel, so re-running `TranscriptDetector.detectAndClean()` here would corrupt it (see §7.2 note below). When skipping for this reason, `cleanTranscript` also strips the now-unneeded sentinel line from the note so it isn't left visible in the final transcript.
7. **Generate summary** (`generateSummary`) → `# Summary`.

### 6.2 Standup — pre-meeting (`detectMode` → transcript empty / < 50 chars & no file ref)
1. `JiraManager.queryAndFormatSprint(boardId, projectKey, team)` → tries `JiraCliClient` first (falls back to `JiraApiClient` REST on failure) → formatted `# JIRA` section.
2. Insert/replace `# JIRA` (after `# Attendees`, else after frontmatter) via `insertJiraSection`, built on the shared `upsertSection` utility.

### 6.3 Standup — post-meeting (transcript has content or a file reference)
1. `peekScreenshotAttendees` (read-only) to seed the voice modal's candidate list.
2. **Voice ID** (before attendees/embed).
3. `processAttendees` (screenshots first, then merge `.whisper` speakers via the `mergeSupplementalAttendees` hook).
4. `expandTranscriptEmbed`.
5. `resolveSpeakers`.
6. `cleanTranscript` (unless `# Copilot Summary`).
7. `generateSummary`.
8. `extractJiraUpdates` (standup-only): find `GLCP-####` mentions in the note, tick their checkboxes in `# JIRA`, and append context.

### 6.4 Summary generation detail
Both handlers branch:
- If a `# Copilot Summary` **and** a transcript both exist → *enhanced/combined* summary (summarise transcript, then merge with the Teams summary).
- Otherwise → *standard* summary from the best available content.
The `summary-generation` skill's section text is injected into the prompt; output is
sanitised by `cleanCopilotOutput` (strips CLI tool-trace lines, leading monologue,
stray headings) before being written to `# Summary`.

---

## 7. Email-chain workflow (`EmailChainHandler`)
1. Extract the `# Email Chain` body.
2. **Participants** (only if `# Participants` is empty): `parseEmailParticipants` scans
   `**From/To/Cc:**` lines, accepts markdown-link or plain `<email>` forms, keeps
   **`@hpe.com`** addresses whose display name contains a comma (personal
   `Last, First`; group mailboxes excluded), dedupes by lowercased email. For each,
   find-or-create a People profile (Copilot infers a 1–3 sentence role blurb) and write
   a wiki-link list.
3. **Summary** (only if `# Summary` is empty): Copilot with the `email-summary` skill →
   *What was discussed / Key decisions / Action items / Open questions*.
4. Re-running an already-populated note is a no-op (preserve-existing).

---

## 8. Voice speaker identification

### 8.1 Plugin side
`VoiceSpeakerResolver.identifyWhisperSpeakers(file, attendeeHints)`:
1. Locate the `.whisper` file (§4.4). Skip if none.
2. `VoiceAnalysisClient.connect()` — health-check `127.0.0.1:{port}/health`; if down and
   `autoStart`, spawn `whisper-speaker-id serve --port <port>` **detached** (log →
   `~/tmp/wsi-daemon.log`) and poll `/health` (2 s interval, up to 5 min — first-run
   model load is slow).
3. `POST /analyze` → per-speaker `{bestMatch, score, action}`. HTTP failure falls back to
   `whisper-speaker-id analyze --input <path> --json`.
4. Show `VoiceSpeakerAttributionModal` seeded with merged attendee hints + wiki-link
   attendees. **Auto-bypasses** (no UI) when every speaker is `action:auto`.
5. `POST /apply` writes chosen names into the `.whisper` file; `POST /save-samples`
   stores voice clips for future auto-ID (HTTP-only; skipped in CLI mode).

The modal also offers a **▶ Play** button per speaker that lazily fetches a clip via
`POST /extract-clip` and plays it through one shared `<audio>` element (see the daemon's
CLAUDE.md for the bounds-guard detail). Each row also shows a short italic sample-quote
excerpt (`extractWhisperSampleQuotes()`, `src/transcript/whisper-sample-quotes.ts`),
selected by **segment duration** (mirroring the daemon's `best_segment_for_playback`/
`longest_segment_by_speaker`, including its ms-vs-seconds timestamp normalization) rather
than by text length, so the displayed quote matches what the ▶ Play clip actually plays in
the common case. (The daemon additionally bounds candidates to the real audio duration as a
defense against corrupted timestamp units — the plugin-side extractor has no access to that
and can't replicate it, so a rare corrupted-timestamp file could still show a mismatched
quote.)

Auto/Confirm rows each have a **"Skip"** checkbox (forces that row to be skipped,
disabling its dropdown/new-name input) and a **"Clear voice cache"** checkbox, gated by
Skip: it stays disabled/unchecked until Skip is checked for that row, and is disabled +
unchecked again if Skip is unchecked (Skip can be checked alone with no wipe). The
Auto-identified, Needs-confirmation, and Unresolved-speakers sections are all
**collapsible** (▶/▼ toggle in each section header, shared via `createCollapsibleSection()`)
— Auto-identified defaults to collapsed (already resolved, nothing to do), while Needs
confirmation and Unresolved speakers default to expanded (need attention). The
**"Skip All"** and **"Clear all voice cache"** buttons live inline in the Needs-confirmation
section's header (not the modal's global footer), so they stay visible/usable even while
that section is collapsed. "Skip All" simply checks every row's "Skip" checkbox (and resets
any Unresolved row's dropdown/typed name back to blank) — it does **not** close the modal,
so the user can still uncheck individual rows or set "Clear voice cache" before finalizing.
"Clear all voice cache" checks every currently-**enabled** "Clear voice cache" checkbox
(i.e. rows whose "Skip" checkbox is already checked) — it never enables a disabled one
itself, so pair it with "Skip All" first to affect every row. Nothing is deleted on
checkbox click — **Apply** collects every row with "Clear voice cache" checked,
shows one combined `window.confirm()` listing all the names to be deleted, and on confirm
calls `forgetSpeaker()` (`DELETE /speakers/{name}`, or the `forget-speaker` CLI as a
fallback) for each, with a summary `Notice`. Cancelling the combined confirm aborts the
whole Apply action.

The `<!-- whisper-source -->` sentinel (§4.4/§6.1) is written whenever the transcript came
from a `.whisper` file, **whether via an explicit `![[...]].whisper]]` embed or an
auto-found-by-meeting-filename match** (no embed present in the note) — both paths pass the
resolved `.whisper` reference through `writeExpandedTranscript`, so `resolveSpeakers` will
correctly skip re-opening the text-heuristic `SpeakerAttributionModal` in either case.
`cleanTranscript` also checks for the sentinel and skips re-cleaning entirely: without this
guard, re-running `TranscriptDetector.detectAndClean()` on the already-clean,
sentinel-prefixed text false-positively matches `GoogleRecorderCleaner` (its `canHandle()`
matches any `[text]` on its own line), whose `clean()` treats any content preceding the
first `[Speaker]` line as "preamble" merged into that speaker's first utterance — corrupting
the transcript into `[Name]\n<!-- whisper-source --> First words...` instead of leaving the
sentinel on its own line. Once `cleanTranscript` confirms it's skipping the re-clean, it also
**strips the sentinel from the note** (a single-line regex removal, written back via
`replaceSection`) rather than leaving the HTML comment visible in the transcript forever —
by that point in the pipeline both consumers (`resolveSpeakers`'s modal-skip and
`cleanTranscript`'s own re-clean-skip) have already used it, so it has served its purpose.

All localhost HTTP uses Node's built-in `http` module (not `fetch`) to bypass Electron's
CSP.

### 8.2 Daemon side (`whisper-speaker-id` v0.3.0)
FastAPI app; state guarded by a `threading.Lock` (pyannote isn't thread-safe); model
loaded in a background thread on startup.

**Endpoints**

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/health` | `{status, model_loaded}` |
| `GET` | `/speakers` | sorted reference-library names |
| `POST` | `/analyze` | `{whisper_path}` → `{speakers[], known_speakers[]}` (503 until initialised, 404 if file missing) |
| `POST` | `/apply` | `{whisper_path, name_map}` → `{updated}` (in-place `.whisper` rewrite) |
| `POST` | `/save-samples` | `{whisper_path, assignments[]}` → `{saved}`; reloads embeddings |
| `POST` | `/extract-clip` | `{whisper_path, speaker_id}` → `{clip_path}`; caches longest in-bounds clip |

**Pipeline** (`analyze_whisper_file`): parse `.whisper` → keep only *generic* speakers →
extract embedded audio → per eligible segment (`duration ≥ 1.0 s`) compute a
`pyannote/embedding` vector (cached) → average per speaker → cosine-match against
reference embeddings.

**Score → action thresholds** (`matcher.py`, `config.py`):
- `score ≥ 0.75` → **auto**
- `0.50 ≤ score < 0.75` → **confirm**
- `score < 0.50` → **skip**

> **Note:** the daemon's own thresholds above only affect its raw `action` field;
> the plugin client-side ignores it and reclassifies every speaker from the raw
> `score` using its own thresholds (`classifySpeakerAction()` in
> `src/voice-analysis-client.ts`): `score ≥ 0.85` → auto, `score < 0.65` →
> unresolved/skip, otherwise → confirm. This lets the plugin's auto/confirm/
> unresolved cutoffs be tuned independently of the daemon.

**Filesystem paths**

| Path | Purpose |
|------|---------|
| `~/.config/whisper-speaker-id/config.toml` (`.bak`) | config (HF token, thresholds, dirs) |
| `~/.cache/whisper-speaker-id/embeddings.pkl` | pickled embedding cache (segments + samples) |
| `~/.whisper-speaker-id/` | reference library root |
| `~/.whisper-speaker-id/{Speaker Name}/sample_###.m4a` | per-speaker voice samples (≤ 10, ≥ 2 s each) |
| `~/.whisper-speaker-id/.processed.json` | SHA-256 of already-ingested reference `.whisper` files |
| `~/Documents/Mac Whisper/Speaker References/` | drop zone for new reference recordings |
| `~/tmp/wsi-audio-cache/{sha256}/{speaker_id}.m4a` | playback clip cache (cleared on daemon startup) |

**CLI subcommands** (`cli.py`): `identify`, `analyze`, `apply`, `save-samples` (via
server), `build-cache`, `cache {clear,info}`, `config {show,init}`, `serve`.

**Audio I/O** (`audio.py`): pure `ffmpeg`/`ffprobe` subprocess calls (no `pydub` —
`audioop` was removed in Python 3.13+). Decode → f32le PCM 16 kHz mono; encode → AAC
M4A 16 kHz mono 64 kbps; duration via `ffprobe`.

**Key dependencies**: `pyannote.audio ≥ 3.1`, `omegaconf` (required by pyannote
checkpoint loading), `fastapi`, `uvicorn`, `click`, `numpy`, `scipy`, `huggingface_hub`.

---

## 9. AI backend (`CopilotClientManager`)
All AI runs through `spawn(cliPath, ['-p', prompt])`. Two methods are actually used:
- `sendPrompt(prompt, attachments?, description?)` — text generation (summaries, profiles).
- `analyzeImageWithCLI(imagePath, prompt, description?)` — vision attendee extraction (files referenced inline as `[📷 /abs/path]`).

A `pendingCalls` counter keeps a single `CopilotWorkingModal` (spinner + elapsed timer)
open across overlapping calls. `showWorking` opens on the first call; `hideWorking`
closes when the counter returns to zero.

> The `@github/copilot-sdk` client path (`initialize`/`createSession`), `queryJiraWithCLI`,
> `sendVisionPrompt`, and the deprecated `resolveWhisperPath` shim have since been
> **removed** (they were dead code — see the refinement report §A). The `@github/copilot-sdk`
> dependency is no longer bundled.

---

## 10. Skills system
`skills/*.md` (only the 3 active files) are loaded by `SkillLoader` at startup and
parsed into `{ purpose, content, sections: Map }`. All three are consumed by code via
`getSkill()`: `summary-generation`, `email-summary`, `daily-summary`. The other six
(`meeting-router`, `general-meeting`, `standup-meeting`, `transcript-cleanup`,
`jira-population`, `attendee-extraction`) were moved to `docs/legacy-skills/` — they're
historical/reference only; their behaviour is now hard-coded in TypeScript. Editing an
active skill changes prompts after an Obsidian reload without recompiling.

---

## 11. JIRA integration
`JiraManager.queryAndFormatSprint()` tries `JiraCliClient` first (when
`settings.jiraCliEnabled`, default on): resolves `JIRA_API_TOKEN` via
`shell-env-token.ts`'s `resolveJiraApiToken()` (`process.env.JIRA_API_TOKEN` →
cached shell-captured value from `$SHELL -ilc 'printf "%s" "$JIRA_API_TOKEN"'`
(needed because Obsidian launched via Launchpad/Spotlight doesn't inherit
`~/.zshrc` exports) → `settings.jiraApiToken` as a last resort — checked last
because it's shared with the REST fallback and can go stale independently; a
stale value there must not shadow a working shell-captured token), then resolves
the active sprint id via
`jira sprint list --state active --plain --no-headers --columns ID,NAME,STATE`
(board-scoped entirely by the `jira` CLI's own `jira init` config — there's no
`--board` flag, and `sprint list --raw` doesn't actually produce JSON despite the
flag existing), then spawns `jira issue list -q "sprint in (<id>)" --raw`. This is
deliberately *not* `project = <KEY> AND sprint in openSprints()` — that JQL is
unscoped to any board/team and returns every open sprint across the whole project
(every team sharing it). On any `JiraCliError` (binary missing, non-zero exit incl.
`401`, no active sprint, timeout, bad JSON), falls back to `JiraApiClient` (Basic Auth via
`requestUrl`): get the active sprint for the board
(`/rest/agile/1.0/board/{id}/sprint?state=active`; if several, prefer one whose name
contains the team), then its issues (`.../sprint/{id}/issue`, fields
`summary,status,assignee,issuetype`). `JiraFormatter` prepends a one-line legend
(`**Key:** ...`, spelling out every icon/emoji below), then renders per-assignee `###`
groups of checkbox lines:

```
- [ ] {typeIcon} {statusEmoji} [KEY](url) - {summary} ({status})
```
Type icons: 📋 Story · 🐛 Bug · ☑️ Task · 🎯 Epic · 📝 Subtask · 📌 other.
Status emoji: ✅ done/closed · 🟢 in-progress · 🟡 review/testing · 🔴 blocked · 🔵 other.

`JiraKeyExtractor` finds `GLCP-####` mentions post-meeting and ticks matching checkboxes.

---

## 12. Settings (`MeetingProcessorSettings`)

| Field | Default | Purpose |
|-------|---------|---------|
| `model` | `auto` | Copilot model, passed as `--model` to every CLI spawn |
| `copilotCliPath` | `copilot` | path to CLI binary |
| `dailyNotesFolder` | `Daily Notes` | daily-note detection |
| `meetingsFolder` | `Meetings` | meeting detection |
| `notesFolder` | `Notes` | email-chain + daily linking |
| `peopleFolder` | `People` | profile storage |
| `mediaFolder` | `Media` | attachments |
| `templatesFolder` | `Templates` | templates |
| `autoCreateProfiles` | `true` | create People profiles for attendees |
| `autoCleanTranscript` | `true` | clean transcript unless `# Copilot Summary` present |
| `jiraEmail` / `jiraApiToken` / `jiraBaseUrl` | `""` / `""` / `https://hpe.atlassian.net` | JIRA REST fallback Basic Auth (CLI path reads `JIRA_API_TOKEN` from env/shell instead) |
| `jiraCliEnabled` | `true` | prefer `jira` CLI over REST for sprint queries |
| `jiraCliPath` | `jira` | path to `jira` CLI executable |
| `greenBoardId` | `214` | sprint board |
| `jiraProjectKey` | `GLCP` | project key |
| `standupKeywords` | `Green Standup, Green Team Daily Meeting` | standup detection |
| `filenamePattern` | `YYYY-MM-DD - *.md` | informational (read-only in UI) |
| `voiceServiceEnabled` | `true` | enable voice ID |
| `voiceServiceBinaryPath` | `whisper-speaker-id` | daemon/CLI binary (use full venv path) |
| `voiceServicePort` | `8765` | daemon port |
| `voiceServiceAutoStart` | `true` | auto-spawn daemon |
| `macWhisperTranscriptsDir` | `~/Documents/Mac Whisper/Meeting Transcripts` | preferred `.whisper` source |

---

## 13. People profiles (actual output)
`PeopleManager` stores `{peopleFolder}/{Last, First}.md`. Created files contain:
```markdown
---
aliases:
  - First Last
email: someone@hpe.com      # only via createProfileWithBody (email chains)
tags:
  - People
---
{optional Copilot-generated body}
```
Links use `[[Last, First|First Last]]`. Generic `Speaker N` and non-name strings are
never turned into profiles.

---

## 14. Build, test, deploy

```bash
npm install
npm run dev      # esbuild watch (inline sourcemaps)
npm run build    # production bundle → main.js
npm test         # jest: 6 suites, ~75 cases
```
Plugin is deployed by **symlink** (`.obsidian/plugins/obsidean-meeting` → repo), so a
build + `Cmd+R` reload is all that's needed. esbuild bundles `jszip`, `mammoth`;
externalises `obsidian`/`electron`/CodeMirror/Node builtins.

Daemon: `cd ~/git/whisper-speaker-id && .venv/bin/pytest -q` (37 tests across
`test_analyze.py`, `test_server.py`, `test_cli_commands.py`, `test_whisper_file.py`).

---

## 15. Module map (plugin)

| Area | Files |
|------|-------|
| Entry / dispatch | `main.ts`, `src/meeting-router.ts`, `src/validators.ts` |
| Handlers | `src/handlers/base-meeting-handler.ts` (shared base), `src/handlers/{general,standup,email,daily-summary}.ts` |
| Section utilities | `src/section-utils.ts` |
| Transcript | `src/transcript/{types,detector,index}.ts`, `cleaner-*.ts` (7) |
| Voice | `src/voice-analysis-{client,types}.ts`, `src/voice-speaker-resolver.ts`, `src/ui/voice-speaker-attribution-modal.ts` |
| Speakers (text) | `src/speaker-resolver.ts`, `src/ui/speaker-attribution-modal.ts` |
| AI / skills | `src/copilot-client.ts`, `src/skill-loader.ts`, `src/output-cleaner.ts`, `skills/*.md` (3 active), `docs/legacy-skills/*.md` (6 unused, kept for reference) |
| People / email | `src/people-manager.ts`, `src/email-parser.ts` |
| JIRA | `src/jira/{cli-client,shell-env-token,api-client,client,extractor,formatter,manager}.ts` |
| UI | `src/ui/{settings-tab,status-bar,copilot-working-modal}.ts` |

