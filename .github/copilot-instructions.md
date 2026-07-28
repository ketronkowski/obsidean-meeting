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
│   ├── BaseMeetingHandler     Shared attendees → transcript → speakers → summary pipeline
│   ├── GeneralMeetingHandler  Thin subclass of BaseMeetingHandler
│   └── StandupMeetingHandler  Subclass of BaseMeetingHandler + JIRA pre/post logic
│
├── section-utils.ts           Shared heading-level-tolerant section utility
│   └── getSection/isSectionEmpty/replaceSection/upsertSection (used by all handlers, incl. daily-summary.ts at level 2)
│
├── JIRA layer
│   ├── JiraCliClient          Preferred path: spawns `jira issue list --raw` CLI
│   ├── shell-env-token.ts     Captures JIRA_API_TOKEN from user's shell env for the CLI
│   ├── JiraApiClient          Direct REST API calls (fallback if CLI unavailable/fails)
│   ├── JiraFormatter          Markdown output with type icons + status emoji + legend
│   ├── JiraKeyExtractor       Extract GLCP-NNNNN keys; update checkboxes + notes
│   └── JiraManager            Tries CLI first, falls back to REST; orchestrates format
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

### JIRA: CLI-first with REST fallback
`JiraManager.queryAndFormatSprint()` tries `JiraCliClient` first (when `jiraCliEnabled`,
default on): first resolves the active sprint id via
`jira sprint list --state active --plain --no-headers --columns ID,NAME,STATE`
(board-scoped entirely by the `jira` CLI's own `jira init` config — there's no `--board`
flag to pass this from the plugin, and `sprint list --raw` doesn't actually produce JSON
despite the flag existing), then spawns `jira issue list -q "sprint in (<id>)" --raw`.
This is deliberately *not* `project = <KEY> AND sprint in openSprints()` — that JQL is
unscoped to any board/team and returns every open sprint across the whole project (every
team sharing it), which surfaced as "the CLI works, but shows other teams' issues".
Auth comes from `JIRA_API_TOKEN`,
resolved by `src/jira/shell-env-token.ts` in priority order: `process.env.JIRA_API_TOKEN` →
a shell-captured value (spawns `$SHELL -ilc 'printf ...'` to source `~/.zshrc`, since
Obsidian launched via Launchpad/Spotlight doesn't inherit shell rc-file exports — same
technique as VS Code's `resolveShellEnv`), cached per plugin load → `settings.jiraApiToken`
as a last resort (checked last, not first, so a stale REST-fallback token saved in plugin
settings can't shadow a working shell-captured one).
On any CLI failure (binary missing, non-zero exit, timeout, bad JSON) it falls back to
`JiraApiClient`, which calls `/rest/agile/1.0/board/{boardId}/sprint?state=active` then
`sprint/{id}/issue` via Obsidian's `requestUrl()` — **never `fetch`** — to avoid CORS in
Electron, using Basic Auth from `settings.jiraEmail`/`settings.jiraApiToken`.

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
- `# Transcript` section empty or < 50 chars → **pre-meeting** (populate JIRA)
- `# Transcript` section has content → **post-meeting** (process + update JIRA)

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
| `jiraCliEnabled` | `true` | Prefer `jira` CLI over REST for sprint queries |
| `jiraCliPath` | `jira` | Path to `jira` CLI executable |
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
| `src/handlers/base-meeting-handler.ts` | Shared attendee/transcript/speaker/summary pipeline |
| `src/handlers/general.ts` | Thin general-meeting subclass (103 lines) |
| `src/handlers/standup.ts` | Standup subclass: pre/post-meeting JIRA logic (418 lines) |
| `src/section-utils.ts` | getSection/isSectionEmpty/replaceSection/upsertSection |
| `src/jira/cli-client.ts` | `JiraCliClient` — preferred JIRA path via `jira` CLI, `--raw` JSON parsing |
| `src/jira/shell-env-token.ts` | Shell-captured `JIRA_API_TOKEN` resolution for the CLI |
| `src/jira/api-client.ts` | JIRA REST API fallback, board sprint queries |
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
