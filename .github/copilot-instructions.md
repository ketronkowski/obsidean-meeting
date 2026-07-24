# GitHub Copilot Instructions — Meeting Processor Plugin

This file provides automatic context to GitHub Copilot when working in this repository.

## Project Overview

An **Obsidian plugin** that automates meeting note processing using the **GitHub Copilot CLI** as its AI engine. The plugin handles two meeting types (standup and general) and integrates with Atlassian JIRA.

- **Language**: TypeScript → compiled to `main.js` (CommonJS) via esbuild
- **Runtime**: Obsidian (Electron), deployed via symlink from vault `.obsidian/plugins/obsidean-meeting`
- **AI Backend**: GitHub Copilot CLI spawned as child processes (`copilot -p <prompt>`)
- **JIRA**: Atlassian Agile REST API with Basic Auth via Obsidian's `requestUrl()`

---

## Architecture

```
MeetingProcessorPlugin (main.ts)
│
├── CopilotClientManager       All Copilot CLI calls — spawns copilot process via -p flag
│   ├── sendPrompt()           General AI generation
│   └── analyzeImageWithCLI()  Vision: embed [📷 /path] in prompt
│
├── SkillLoader                Reads skills/*.md files at startup; injects into prompts
│
├── MeetingRouter              Classifies meeting type and dispatches
│   ├── GeneralMeetingHandler  Attendees → transcript cleaning → summary
│   └── StandupMeetingHandler  JIRA (pre-meeting) or attendees+summary+JIRA-update (post)
│
├── JIRA layer
│   ├── JiraApiClient          Direct REST API calls (primary path)
│   ├── JiraFormatter          Markdown output with type icons + status emoji
│   ├── JiraKeyExtractor       Extract GLCP-NNNNN keys; update checkboxes + notes
│   └── JiraManager            Orchestrates query → group → format
│
├── Transcript layer
│   ├── TranscriptDetector     Priority-ordered cleaner chain
│   └── Cleaners (7 formats)   WhisperFileMeta, MacWhisper, TeamsDirectPaste,
│                               TeamsDownloaded, TeamsDocx, GoogleRecorder, Simple
│
├── PeopleManager              Create/find People profile notes in vault
├── SpeakerResolver            Map [Speaker N] labels → real attendee names
├── OutputCleaner              Strip CLI trace artifacts from Copilot responses
│
└── UI
    ├── CopilotWorkingModal    Spinner + status + elapsed timer; stays open across calls
    ├── SpeakerAttributionModal Assign [Speaker N] → attendees before transcript update
    ├── StatusBarManager       Progress messages in Obsidian status bar
    └── MeetingProcessorSettingTab  Settings UI
```

---

## Critical Implementation Notes

### All AI calls use `spawn(copilotCLI, ['-p', prompt])`
The `@github/copilot-sdk` session API was removed entirely (it was dead code —
had no callers due to stdio/JSON-RPC reliability issues in Electron). Every AI
call spawns `copilot -p <prompt>` as a child process and collects stdout.

### Skills system (`skills/*.md`)
AI prompt content lives in editable markdown files. Only 3 skills are still loaded
and consumed (`summary-generation`, `email-summary`, `daily-summary`); 6 others were
relabeled as design notes under `docs/legacy-skills/` since their logic is now
hard-coded in TypeScript. `SkillLoader` reads the 3 active files at startup. Each
skill file has a `## Purpose` section and task-specific sections.

### JIRA uses direct REST API
`JiraApiClient` calls `/rest/agile/1.0/board/{boardId}/sprint?state=active` then `sprint/{id}/issue`. Uses Obsidian's `requestUrl()` — **never `fetch`** — to avoid CORS in Electron.

### Transcript detection order is critical
`WhisperFileMetaCleaner` must appear before `MacWhisperJsonCleaner` (both handle JSON). `SimpleTranscriptCleaner` always returns `true` from `canHandle()` and must be last.

### Concurrent Copilot calls
`CopilotClientManager.pendingCalls` counter keeps the working modal open across multiple sequential CLI spawns. `showWorking()` increments; `hideWorking()` decrements and closes at zero.

---

## File & Meeting Requirements

**Valid meeting file** must satisfy ALL:
- Extension: `.md`
- Path starts with `{meetingsFolder}/` (default `Meetings/`)
- Filename matches `YYYY-MM-DD - <name>.md`
- Frontmatter has `meeting` tag

**Meeting type detection**:
- Filename contains any `standupKeywords` (default: `Green Standup`) → **standup**
- Otherwise → **general**

**Standup mode detection**:
- `## Transcript` section empty or < 50 chars → **pre-meeting** (populate JIRA)
- `## Transcript` section has content → **post-meeting** (process + update JIRA)

---

## Build & Workflow

```bash
npm install          # Install dependencies
npm run dev          # Watch mode (inline sourcemaps)
npm run build        # Production build → main.js
```

After building: reload Obsidian with `Cmd+R` (no full restart needed).

**Deployment**: symlinked — the repo IS the installed plugin.

---

## Settings Reference

| Setting | Default | Notes |
|---------|---------|-------|
| `copilotCliPath` | `copilot` | Full path if not on PATH |
| `model` | `auto` | Passed to Copilot CLI as `--model` |
| `meetingsFolder` | `Meetings` | Relative to vault root |
| `dailyNotesFolder` | `Daily Notes` | Relative to vault root; daily-summary notes |
| `peopleFolder` | `People` | People profile notes |
| `greenBoardId` | `214` | Green Team JIRA board |
| `jiraProjectKey` | `GLCP` | Project key |
| `standupKeywords` | `Green Standup` | Comma-separated |
| `macWhisperTranscriptsDir` | `~/Documents/Mac Whisper/Meeting Transcripts` | Source dir for auto-locating `.whisper` files |

---

## Coding Conventions

- All Obsidian vault/file ops go through `this.app.vault` and `this.app.workspace`
- Use `requestUrl()` from `obsidian` for HTTP — never `fetch`
- Spawn CLI with `require('child_process').spawn` (Node builtins available; esbuild platform: node)
- Call `cleanCopilotOutput(raw)` on every CLI response before inserting into notes
- UI components extend `Modal` from `obsidian`
- Settings use `Setting` from `obsidian` inside `PluginSettingTab`

---

## Key Files Quick Reference

| File | What it does |
|------|-------------|
| `main.ts` | Plugin lifecycle, ribbon/command registration |
| `src/copilot-client.ts` | `sendPrompt`, `analyzeImageWithCLI`, modal management |
| `src/meeting-router.ts` | Dispatch to general or standup handler |
| `src/validators.ts` | File validation, meeting type/team detection |
| `src/handlers/general.ts` | Full general meeting workflow |
| `src/handlers/standup.ts` | Standup pre/post-meeting workflow |
| `src/jira/api-client.ts` | JIRA REST API, board sprint queries |
| `src/jira/formatter.ts` | Issue type icons + status emoji |
| `src/jira/extractor.ts` | Regex extract JIRA keys; checkbox + note updates |
| `src/transcript/detector.ts` | Auto-detect transcript format |
| `src/people-manager.ts` | Find/create People profile notes |
| `src/speaker-resolver.ts` | Heuristic [Speaker N] → name resolution |
| `src/output-cleaner.ts` | Strip CLI trace lines from AI output |
| `src/skill-loader.ts` | Load and parse `skills/*.md` at startup |

---

## Resources

- [Obsidian Plugin API](https://github.com/obsidianmd/obsidian-api)
- [GitHub repository](https://github.com/ketronkowski/obsidean-meeting)
- Full architecture details: `docs/ARCHITECTURE.md`
- Implementation details: `docs/IMPLEMENTATION.md`
