# Architecture — Meeting Processor Plugin

## Overview

The Meeting Processor plugin follows a **pipeline architecture**: a single entry point validates the active file, classifies it, and dispatches to a type-specific handler that orchestrates a sequence of AI and API calls.

```
User Action (ribbon click / command)
        │
        ▼
MeetingProcessorPlugin.processMeeting()
        │
        ├── validateMeetingFile()  ── rejects non-meeting files early
        │
        ▼
MeetingRouter.process()
        │
        ├── detectMeetingType() ── "standup" | "general"
        │
        ├── [standup] ── StandupMeetingHandler.process()
        │                     │
        │                     ├── detectTeam() → boardId
        │                     ├── [pre-meeting] JiraManager.queryAndFormatSprint()
        │                     │                 JiraApiClient → JIRA REST API
        │                     │                 JiraFormatter → markdown section
        │                     └── [post-meeting] attendees + transcript + summary
        │                                         JiraKeyExtractor → checkbox updates
        │
        └── [general] ── GeneralMeetingHandler.process()
                              │
                              ├── PeopleManager → find/create profiles
                              ├── CopilotClientManager.analyzeImageWithCLI() → attendee names
                              ├── TranscriptDetector.detectAndClean() → clean transcript
                              ├── CopilotClientManager.sendPrompt() → summary
                              └── SpeakerAttributionModal (if [Speaker N] labels found)
```

---

## Component Responsibilities

### `MeetingProcessorPlugin` (`main.ts`)
- Plugin lifecycle (`onload`, `onunload`)
- Registers ribbon icon (brain-circuit), command palette entry, and settings tab
- Owns all top-level component instances
- Prevents double-processing with `processing: boolean` guard
- Loads skills at startup via `SkillLoader`

### `CopilotClientManager` (`src/copilot-client.ts`)
Central hub for all AI calls. Two execution paths:

| Method | Mechanism | Used for |
|--------|-----------|----------|
| `sendPrompt()` | `spawn(copilot, ['-p', prompt])` | Summary, attendee extraction |
| `analyzeImageWithCLI()` | `spawn(copilot, ['-p', '... [📷 /path] ...'])` | Vision: Teams screenshot attendees |

**Modal lifecycle**: Uses a `pendingCalls` reference counter. The `CopilotWorkingModal` opens on the first call and stays open until all pending calls finish (counter returns to zero).

**SDK**: removed. `@github/copilot-sdk`'s `initialize()`/`createSession()` were dead
code (no callers) due to Electron stdio/JSON-RPC reliability issues, and have been
deleted along with the dependency; `queryJiraWithCLI()` and `sendVisionPrompt()`
(also unused) were removed too. All AI now goes exclusively through CLI spawn.

### `MeetingRouter` (`src/meeting-router.ts`)
- Reads `file.basename` and checks against `standupKeywords` setting
- Instantiates both handlers once and holds references
- Stateless dispatch — no processing logic here

### `GeneralMeetingHandler` (`src/handlers/general.ts`)
Orchestrates the full general meeting pipeline:
1. **Attendee extraction** — looks for `![[SCR-*.png]]` image references; calls vision API or falls back to content scanning
2. **People profile management** — creates missing profiles in `peopleFolder`
3. **Transcript cleaning** — skips if `## Copilot Summary` already has content
4. **Speaker attribution** — opens `SpeakerAttributionModal` if `[Speaker N]` labels found
5. **Summary generation** — calls Copilot with skill prompt; result is cleaned and inserted

### `StandupMeetingHandler` (`src/handlers/standup.ts`)
Two modes based on transcript presence:

**Pre-meeting** (transcript empty/short):
1. Query JIRA active sprint → format → insert `## JIRA` section
2. Populate expected attendees from config or previous standups

**Post-meeting** (transcript present):
1. Same attendee + transcript + summary pipeline as general meeting
2. `JiraKeyExtractor.extractKeys()` scans transcript and summary for `GLCP-NNNNN` patterns
3. Matched keys have their checkboxes ticked and context notes appended in the JIRA section

### `SkillLoader` (`src/skill-loader.ts`)
- Reads all `*.md` files from `{pluginDir}/skills/` at startup via Obsidian's `adapter.read()`
- Parses each file into a `Skill` object: `{ name, purpose, content, sections: Map<string,string> }`
- Sections are parsed by `## Heading` boundaries
- Handlers call `skillLoader.getSkill('general-meeting')` and inject `skill.content` into prompts

### JIRA Layer (`src/jira/`)

```
JiraManager
    └── JiraApiClient        HTTP calls to Atlassian Agile REST API
    └── JiraFormatter        Markdown rendering
    └── (JiraKeyExtractor)   Used directly by StandupMeetingHandler
```

**`JiraApiClient`** flow:
1. `GET /rest/agile/1.0/board/{boardId}/sprint?state=active` → find active sprint
2. If multiple active sprints, match by team name in sprint title
3. `GET /rest/agile/1.0/board/{boardId}/sprint/{sprintId}/issue?fields=summary,status,assignee,issuetype` → get issues
4. Transform to `JiraIssue[]`

Uses Obsidian `requestUrl()` — avoids CORS restrictions in the Electron webview.

**`JiraFormatter`** icon system:
- Issue types: 📋 Story, 🐛 Bug, ☑️ Task, 🎯 Epic, 📝 Subtask, 📌 Other
- Statuses: ✅ Done/Closed, 🟢 In Progress, 🟡 In Review/Testing, 🔴 Blocked, 🔵 To Do/Other

**`JiraKeyExtractor`** regex: `/\b([A-Z]+-\d+)\b/g`

### Transcript Layer (`src/transcript/`)

**Detector priority order** (first `canHandle()` returning `true` wins):

| # | Cleaner | Detection Signal |
|---|---------|-----------------|
| 1 | `WhisperFileMetaCleaner` | JSON with `speaker` as object `{name, id}` |
| 2 | `MacWhisperJsonCleaner` | JSON with `speaker` as string |
| 3 | `TeamsDirectPasteCleaner` | `\d+:\d+:\d+ [AP]M` + `teams.microsoft.com` URL |
| 4 | `TeamsDownloadedCleaner` | `\*\*Speaker\*\* HH:MM AM/PM` pattern |
| 5 | `TeamsDocxCleaner` | Plain text with leading spaces, extracted from DOCX |
| 6 | `GoogleRecorderCleaner` | Google Recorder specific format |
| 7 | `SimpleTranscriptCleaner` | Always `true` — fallback |

### `PeopleManager` (`src/people-manager.ts`)
- Searches `peopleFolder` for files matching extracted names
- Fuzzy matching (>80% similarity threshold)
- Creates profile stubs from template when `autoCreateProfiles` is enabled
- Returns wiki-link strings: `[[First Last]]`

### `SpeakerResolver` (`src/speaker-resolver.ts`)
- Detects generic `[Speaker N]` patterns in cleaned transcripts
- Builds `SpeakerProfile` objects with sample quotes per speaker
- Attempts auto-mapping by:
  - Matching known attendee names to quoted content
  - Heuristics (question patterns → possible speaker identity)
- Low-confidence or unresolved speakers → `SpeakerAttributionModal`

### `OutputCleaner` (`src/output-cleaner.ts`)
Strips Copilot CLI trace artifacts from responses:
- Lines starting with `●`, `✓`, `✗` (tool status indicators)
- Lines starting with `│`, `└` (command output indentation)
- `| ` pipe-table lines (CLI tabular output)
- "placeholder..." boilerplate
- Content before first `\n---\n` separator (internal monologue)
- Runs of 3+ blank lines → 2 blank lines

---

## UI Components

### `CopilotWorkingModal`
- Extends Obsidian `Modal`
- Blocks Escape key and outside-click dismissal
- Animated dots (`.`, `..`, `...`) via `setInterval`
- Elapsed timer updating every second
- `updateStatus(message)` allows mid-call status updates without resetting timer

### `SpeakerAttributionModal`
- Two sections: auto-detected (collapsible) and unresolved (always expanded)
- Each speaker shows sample quotes to aid identification
- Dropdowns for assignment; shows confidence percentage for auto-detected
- "Apply Mappings" resolves the Promise; "Skip All" resolves with empty array

### `StatusBarManager`
- Thin wrapper around a status bar `HTMLElement`
- `show(message, duration)` — auto-hides after `duration` ms (0 = indefinite)
- Hidden by default; shown only during processing

---

## Data Flow: General Meeting

```
vault.read(file)
    │
    ▼
Extract image references (![[SCR-*.png]])
    │
    ├── [images found] analyzeImageWithCLI(imagePath)
    │       → "John Smith, Jane Doe, Alice Johnson"
    │
    └── [no images] Scan content for speaker names
    │
    ▼
PeopleManager.findOrCreate(names)
    → ["[[John Smith]]", "[[Jane Doe]]", "[[Alice Johnson]]"]
    │
    ▼
Update ## Attendees section in file
    │
    ▼
[if transcript present and no Copilot Summary]
TranscriptDetector.detectAndClean(transcriptContent)
    → { cleaner: "TeamsDirectPaste", cleaned: "..." }
    │
    ├── [Speaker N] found → SpeakerAttributionModal → user maps speakers
    │
    ▼
Update ## Transcript section with cleaned text
    │
    ▼
sendPrompt(summarySkill + cleanedTranscript)
    → raw AI response
    │
    ▼
cleanCopilotOutput(raw)
    → clean markdown summary
    │
    ▼
Update ## Summary section in file
```

---

## Data Flow: Standup Pre-Meeting

```
vault.read(file) → detect transcript is empty
    │
    ▼
detectTeam(file) → "green" → boardId = "214"
    │
    ▼
JiraApiClient.searchBoardSprintIssues("214", "green")
    → GET /rest/agile/1.0/board/214/sprint?state=active
    → GET /rest/agile/1.0/board/214/sprint/{id}/issue
    → JiraIssue[]
    │
    ▼
groupIssuesByAssignee(issues)
    → { "John Smith": [...], "Jane Doe": [...], "Unassigned": [...] }
    │
    ▼
JiraFormatter.createJiraSection(grouped)
    → markdown string with checkboxes, icons, status emoji, links
    │
    ▼
Insert/replace ## JIRA section in file
```

---

## Dependency Graph

```
main.ts
 ├── src/ui/settings-tab.ts       (MeetingProcessorSettings, DEFAULT_SETTINGS)
 ├── src/copilot-client.ts        → child_process
 ├── src/meeting-router.ts
 │    ├── src/handlers/general.ts
 │    │    ├── src/copilot-client.ts
 │    │    ├── src/skill-loader.ts
 │    │    ├── src/transcript/ (detector + all cleaners)
 │    │    ├── src/people-manager.ts
 │    │    ├── src/speaker-resolver.ts
 │    │    ├── src/output-cleaner.ts
 │    │    └── src/ui/speaker-attribution-modal.ts
 │    └── src/handlers/standup.ts
 │         ├── src/jira/ (manager, api-client, formatter, extractor, client)
 │         └── (same as general.ts)
 ├── src/validators.ts
 ├── src/skill-loader.ts
 ├── src/ui/status-bar.ts
 └── src/ui/copilot-working-modal.ts
```

---

## Configuration Storage

Settings are persisted via Obsidian's `loadData()` / `saveData()` which stores to `.obsidian/plugins/obsidean-meeting/data.json`. The `MeetingProcessorSettings` interface is merged with `DEFAULT_SETTINGS` on load, ensuring new fields added in updates are always initialised.

---

## Error Handling Strategy

- Validation errors → `new Notice(message)` + early return (not thrown)
- JIRA errors → caught in `JiraManager`, returns formatted error string inserted into note
- Copilot CLI errors → caught in `sendPrompt()`/`analyzeImageWithCLI()`, thrown to handler
- Handler-level errors → caught in `main.ts:processMeeting()`, displayed as Notice
- `processing` flag is reset in `finally` block to ensure no deadlock on re-entry

All errors are also logged to console for debugging via Obsidian dev tools (`Cmd+Option+I`).
