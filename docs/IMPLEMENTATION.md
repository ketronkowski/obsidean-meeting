# Implementation Guide — Meeting Processor Plugin

## Development Setup

### Prerequisites
- Node.js 18+ (recommend: nvm)
- GitHub Copilot CLI installed and authenticated
- An Obsidian vault with the standard folder structure

### Initial Setup

```bash
# Clone repository
git clone https://github.com/ketronkowski/obsidean-meeting.git ~/git/obsidean-meeting
cd ~/git/obsidean-meeting

# Install dependencies
npm install

# Build
npm run build

# Deploy via symlink (one-time)
ln -s ~/git/obsidean-meeting ~/path/to/vault/.obsidian/plugins/obsidean-meeting

# Enable in Obsidian: Settings → Community Plugins → Meeting Processor
```

### Development Loop

```bash
# Watch mode — auto-rebuilds on file changes
npm run dev
```

After any build, reload Obsidian:
- `Cmd+R` (macOS) in Obsidian, or
- Command palette → "Reload app without saving"

**No Obsidian restart needed** for TypeScript changes. Skill file (`skills/*.md`) changes take effect on plugin reload.

---

## Deployment Options

### Option 1: Symlink (Development / Personal Use) ✅ Current
The repository directory is symlinked directly into Obsidian's plugin folder.

```bash
ln -s ~/git/obsidean-meeting ~/path/to/vault/.obsidian/plugins/obsidean-meeting
```

**Pros**: Instant — no copy step. Edit code, rebuild, reload Obsidian.  
**Cons**: Requires the repo to stay at the symlink source path.

Verify with:
```bash
ls -la ~/path/to/vault/.obsidian/plugins/obsidean-meeting
# → lrwxr-xr-x → /Users/kevin/git/obsidean-meeting
```

### Option 2: BRAT (Beta Reviewers Auto-update Tool)

For distributing beta versions to other Obsidian users without waiting for community plugin approval.

1. Install [BRAT plugin](https://github.com/TfTHacker/obsidian42-brat) in Obsidian
2. Settings → BRAT → Add Beta Plugin → enter `ketronkowski/obsidean-meeting`
3. BRAT clones from the GitHub repo into the vault's plugins folder
4. Updates can be pushed by releasing new versions on GitHub

**Pros**: Easy install for others; auto-updates via BRAT.  
**Cons**: Requires GitHub releases; BRAT must be installed first.

### Option 3: Manual Installation

Download and install without BRAT:

1. Go to [GitHub Releases](https://github.com/ketronkowski/obsidean-meeting/releases)
2. Download the latest release zip
3. Extract and copy the folder to `{vault}/.obsidian/plugins/obsidean-meeting/`
4. Restart Obsidian → Settings → Community Plugins → Enable

**Required release files** (in the zip):
- `main.js` — compiled plugin
- `manifest.json` — plugin metadata
- `styles.css` — modal styles
- `skills/` — all skill markdown files (required at runtime)

### Option 4: Obsidian Community Plugins (Future)

Submit to the official Obsidian community plugin registry for discovery in the app's plugin browser.

Requirements:
- Plugin must pass Obsidian's review process
- `manifest.json` must be correct
- Must not use `eval()` or dynamic code execution
- Must handle errors gracefully

See [Obsidian Plugin Submission Guidelines](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin).

---

## Adding Features

### Adding a New Setting

1. **`src/ui/settings-tab.ts`** — add to interface and defaults:
```typescript
export interface MeetingProcessorSettings {
    // ... existing fields
    myNewSetting: boolean;
}

export const DEFAULT_SETTINGS: MeetingProcessorSettings = {
    // ... existing defaults
    myNewSetting: false,
};
```

2. **`src/ui/settings-tab.ts`** — add UI in `display()`:
```typescript
new Setting(containerEl)
    .setName('My New Setting')
    .setDesc('Description of what this does')
    .addToggle(toggle => toggle
        .setValue(this.plugin.settings.myNewSetting)
        .onChange(async (value) => {
            this.plugin.settings.myNewSetting = value;
            await this.plugin.saveSettings();
        }));
```

3. Use `this.settings.myNewSetting` in any handler that needs it.

### Adding a New Transcript Format

1. Create `src/transcript/cleaner-myformat.ts`:
```typescript
import { TranscriptCleaner } from './types';

export class MyFormatCleaner implements TranscriptCleaner {
    getName(): string { return 'MyFormat'; }

    canHandle(content: string): boolean {
        // Return true if this content matches your format
        return /specific-pattern/.test(content);
    }

    clean(content: string): string {
        // Transform content to "Speaker\nContent\n" format
        return content; // implement cleaning
    }
}
```

2. Register in `src/transcript/detector.ts`:
```typescript
import { MyFormatCleaner } from './cleaner-myformat';

// Add to this.cleaners array, BEFORE SimpleTranscriptCleaner
this.cleaners = [
    new WhisperFileMetaCleaner(),
    new MacWhisperJsonCleaner(),
    new MyFormatCleaner(),   // ← add here (order matters!)
    // ...
    new SimpleTranscriptCleaner()  // must stay last
];
```

3. Export from `src/transcript/index.ts`.

### Adding a New Skill

1. Create `skills/my-skill.md`:
```markdown
# My Skill

## Purpose
What this skill enables.

## Workflow
Step-by-step instructions for the AI.

## Output Format
\```markdown
Expected output format
\```
```

2. Load and use in a handler:
```typescript
const skill = this.skillLoader.getSkill('my-skill');
const prompt = `${skill.content}\n\n${inputData}`;
const response = await this.copilotClient.sendPrompt(prompt, undefined, 'Doing my thing...');
const clean = cleanCopilotOutput(response);
```

### Adding a New JIRA Issue Type Icon

Edit `src/jira/formatter.ts` in `getIssueTypeIcon()`:
```typescript
} else if (typeLower.includes('spike')) {
    return '🔍';
```

---

## Key Patterns

### Reading and Writing Vault Files

Always use Obsidian's API — never Node.js `fs`:

```typescript
// Read
const content = await this.app.vault.read(file);

// Write
await this.app.vault.modify(file, newContent);

// Create new file
await this.app.vault.create(path, content);

// Check if file exists
const exists = this.app.vault.getAbstractFileByPath(path) !== null;
```

### Updating a Section in a Note

Common pattern used throughout the handlers:

```typescript
// Replace or insert a section
function updateSection(content: string, sectionName: string, newBody: string): string {
    const regex = new RegExp(`(## ${sectionName}\\s*\\n)[\\s\\S]*?(?=\\n##|$)`, 'm');
    const replacement = `## ${sectionName}\n${newBody}\n`;
    if (regex.test(content)) {
        return content.replace(regex, replacement);
    }
    // Section doesn't exist — append it
    return content + `\n## ${sectionName}\n${newBody}\n`;
}
```

### Sending a Prompt to Copilot

```typescript
// Simple text prompt
const response = await this.copilotClient.sendPrompt(
    `Summarize this meeting:\n\n${transcript}`,
    undefined,
    'Generating summary...'  // status message for working modal
);
const summary = cleanCopilotOutput(response);

// With file attachments (for larger context)
const response = await this.copilotClient.sendPrompt(
    prompt,
    [{ type: 'file', path: '/absolute/path/to/file.md' }],
    'Analyzing content...'
);

// Vision (image analysis)
const names = await this.copilotClient.analyzeImageWithCLI(
    '/absolute/path/to/screenshot.png',
    'List the names shown in this image',
    'Extracting attendees...'
);
```

### Skill-Driven Prompts

```typescript
const skill = this.skillLoader.getSkill('summary-generation');
if (!skill) {
    throw new Error('summary-generation skill not found');
}

const prompt = `${skill.content}

Meeting transcript to summarize:
${transcript}`;

const response = await this.copilotClient.sendPrompt(prompt, undefined, 'Generating summary...');
```

### Making JIRA API Calls

```typescript
import { requestUrl } from 'obsidian';

const response = await requestUrl({
    url: `${this.settings.jiraBaseUrl}/rest/agile/1.0/board/${boardId}/sprint?state=active`,
    method: 'GET',
    headers: {
        'Authorization': `Basic ${btoa(`${email}:${token}`)}`,
        'Accept': 'application/json'
    }
});

if (response.status !== 200) {
    throw new Error(`JIRA API error: ${response.status}`);
}

const sprints = response.json.values;
```

---

## Testing Checklist

Since there are no automated tests, use this manual checklist:

### General Meeting
- [ ] Open a meeting note matching `YYYY-MM-DD - *.md` in `Meetings/` with `tags: [meeting]`
- [ ] Click the brain-circuit ribbon icon
- [ ] Verify working modal appears with spinner + elapsed timer
- [ ] Verify attendees extracted (from screenshot or content)
- [ ] Verify People profiles created/linked in `## Attendees`
- [ ] Verify transcript cleaned (if present and no Copilot Summary)
- [ ] Verify summary generated in `## Summary`
- [ ] Verify status bar shows success message
- [ ] Verify working modal closes

### Standup — Pre-Meeting
- [ ] Open a `YYYY-MM-DD - Green Standup.md` with empty `## Transcript`
- [ ] Click process button
- [ ] Verify `## JIRA` section populated with sprint issues
- [ ] Verify issues grouped by assignee with icons and links
- [ ] Verify issue type icons correct (📋🐛☑️🎯)
- [ ] Verify status emoji correct (✅🟢🟡🔴🔵)

### Standup — Post-Meeting
- [ ] Open a standup note with content in `## Transcript`
- [ ] Click process button
- [ ] Verify transcript cleaned
- [ ] Verify summary generated
- [ ] Verify JIRA keys mentioned in transcript get checked (✅) in `## JIRA`
- [ ] Verify context notes appended to checked items

### Error Cases
- [ ] Non-meeting file → Notice: "File must be in the Meetings folder"
- [ ] Wrong filename pattern → Notice: "Filename must match pattern"
- [ ] Missing `meeting` tag → Notice: "File must have 'meeting' tag"
- [ ] Copilot not found → Notice with install instructions
- [ ] JIRA credentials missing → Error message inserted in JIRA section
- [ ] Double-click ribbon → Notice: "Meeting processing already in progress"

---

## Debugging

Open Obsidian developer tools: `Cmd+Option+I` (macOS)

Key log messages to watch:
```
Plugin directory: .obsidian/plugins/obsidean-meeting
Copilot client initialized and started successfully
Processing general meeting: 2026-05-21 - Team Sync
Detected transcript format: TeamsDirectPaste
Found 42 issues in active sprint
Extracted 3 JIRA keys: GLCP-12345, GLCP-12346, GLCP-12347
Checking box for GLCP-12345
```

For CLI issues:
```bash
# Verify CLI is accessible
which copilot

# Verify authentication
copilot auth status

# Test a simple prompt
copilot -p "Say hello"
```

---

## Release Process

1. Update version in `manifest.json` and `package.json`
2. Run `npm run version` (updates `versions.json` and stages the changes)
3. Run `npm run build`
4. Test the built `main.js`
5. Commit: `git commit -m "chore: release v0.x.x"`
6. Tag: `git tag v0.x.x`
7. Push: `git push && git push --tags`
8. Create GitHub Release with the tag; attach:
   - `main.js`
   - `manifest.json`
   - `styles.css`
   - `skills/` directory (zipped)

---

## Obsidian API Quick Reference

```typescript
// Vault operations
this.app.vault.read(file: TFile): Promise<string>
this.app.vault.modify(file: TFile, content: string): Promise<void>
this.app.vault.create(path: string, content: string): Promise<TFile>
this.app.vault.getAbstractFileByPath(path: string): TAbstractFile | null
this.app.vault.getMarkdownFiles(): TFile[]

// Workspace
this.app.workspace.getActiveFile(): TFile | null

// Notices (toast messages)
new Notice('Message text', durationMs?): void

// HTTP requests (CORS-safe in Electron)
requestUrl({ url, method, headers, body }): Promise<RequestUrlResponse>
// response.status, response.json, response.text, response.arrayBuffer
```
