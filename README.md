# Meeting Processor Plugin for Obsidian

Automate your meeting note processing with AI-powered workflows. This Obsidian plugin integrates with the GitHub Copilot CLI to process daily notes, standup meetings, general meetings, and email-chain notes with a single click.

## Features

- **One-Click Processing**: A single command auto-detects the active file's type (daily note, standup, general meeting, or email chain) and routes it to the right handler
- **Smart Meeting Detection**: Automatically detects standup vs. general meetings from filename keywords
- **Attendee Extraction**: Extract attendees from Teams screenshots using Copilot vision, or from transcript content as a fallback
- **People Profiles**: Auto-create and link People profiles for attendees
- **Transcript Cleaning**: Cleans transcripts from 7 supported formats — 3 Teams paste/export variants, Google Recorder, a generic fallback, MacWhisper JSON, and MacWhisper `.whisper` bundles
- **Voice Speaker Identification**: Optional integration with the `whisper-speaker-id` daemon to auto-attribute `.whisper` transcript speakers to People profiles by voice embedding, with an in-app dialog (including audio playback of the matched segment) for anything below the auto-accept confidence threshold
- **AI-Powered Summaries**: Generate concise meeting summaries using the GitHub Copilot CLI
- **Email Chain Processing**: Summarize pasted email threads into a People-linked participant list + AI summary
- **Daily Summary Generation**: Roll up a day's meetings/notes into a Daily Note summary
- **JIRA Integration**: Auto-populate standup notes with active sprint issues via direct REST API, and auto-check off JIRA items mentioned in standup content
- **Status Bar**: Real-time progress updates during processing
- **Configurable**: Toggle features, customize paths, models, and JIRA board settings

## Requirements

- **Obsidian** 1.0 or higher
- **GitHub Copilot CLI** installed and authenticated (`npm install -g @github/copilot-cli`)
- **JIRA API Token** (optional, for JIRA integration)
  - Get from: https://id.atlassian.com/manage-profile/security/api-tokens
- **`whisper-speaker-id` daemon** (optional, for voice-based speaker identification) — see the companion repo

## Installation

### Method 1: BRAT (Recommended for Beta Testing)

1. Install the [BRAT plugin](https://github.com/TfTHacker/obsidian42-brat)
2. Open Settings → BRAT → Add Beta Plugin
3. Enter: `ketronkowski/obsidean-meeting`
4. Enable the plugin in Settings → Community Plugins

### Method 2: Manual Installation

1. Download the latest release from [GitHub Releases](https://github.com/ketronkowski/obsidean-meeting/releases)
2. Extract the zip file
3. Copy the folder to `{vault}/.obsidian/plugins/`
4. Restart Obsidian
5. Enable the plugin in Settings → Community Plugins

### Method 3: Local Development

1. Clone the repository:
   ```bash
   git clone https://github.com/ketronkowski/obsidean-meeting.git ~/git/obsidean-meeting
   cd ~/git/obsidean-meeting
   npm install
   npm run build
   ```

2. Create a symlink to your vault:
   ```bash
   ln -s ~/git/obsidean-meeting ~/path/to/vault/.obsidian/plugins/obsidean-meeting
   ```

3. Restart Obsidian
4. Enable the plugin in Settings → Community Plugins

## Usage

### Processing a Note

1. Open a daily note, meeting note, or email-chain note in Obsidian
2. Click the brain icon in the ribbon, OR
3. Open Command Palette (Cmd+P) and run "Process Meeting"

The plugin checks the active file against daily-note, meeting, then email-chain
rules (in that order) and routes it to the matching handler automatically.

### Meeting File Requirements

Your meeting notes must:
- Be located in the configured Meetings folder (default: `Meetings/`)
- Follow the naming pattern: `YYYY-MM-DD - {Name}.md`
- Have `meeting` tag in frontmatter
- Example: `2026-02-05 - Product Planning.md`

### Note Types

#### General Meetings
Any meeting that doesn't match standup keywords.

**Processing workflow:**
1. Extract attendees from screenshots or content, into `# Attendees`
2. Clean transcript in `# Transcript` (skipped if `# Copilot Summary` already has content)
3. Generate summary into `# Summary`

#### Standup Meetings
Meetings with "Green Standup" in the filename.

**Pre-meeting mode** (`# Transcript` empty or <50 chars):
1. Populate `# JIRA` section with active sprint issues
2. Add expected attendees

**Post-meeting mode** (`# Transcript` has content):
1. Process attendees
2. Clean transcript (if needed)
3. Generate summary
4. Extract JIRA key mentions and check them off in `# JIRA`

#### Email Chain Notes
Notes (typically in `Notes/`) tagged for email-chain processing. Extracts HPE
participants into People-linked profiles under `# Participants` and generates
an AI summary under `# Summary`.

#### Daily Notes
Notes matching the `dailyNotesFolder` daily-note filename pattern
(`YYYY-MM-DD.md`). Rolls up the day's linked meetings/notes into a
`## Daily Summary` section.

## Configuration

Go to Settings → Community Plugins → Meeting Processor

### AI Settings
- **Model**: AI model passed to `copilot --model` (Auto, Claude Sonnet 4.5, Claude Opus 4.5, Claude Haiku 4.5, GPT-5 mini; default: `auto`)
- **Copilot CLI Path**: Path to copilot executable (default: `copilot`)

### Processing Preferences
- **Auto-create People Profiles**: Automatically create People profiles for attendees (default: enabled)
- **Auto-clean Transcripts**: Automatically clean transcripts (default: enabled)

### Vault Paths
- **Meetings Folder**: Where meeting notes are stored (default: `Meetings`)
- **Daily Notes Folder**: Where daily notes are stored (default: `Daily Notes`)
- **Notes Folder**: Where notes and email-chain notes are stored (default: `Notes`)
- **People Folder**: Where people profiles are stored (default: `People`)
- **Media Folder**: Where attachments are stored (default: `Media`)
- **Templates Folder**: Where templates are stored (default: `Templates`)

### JIRA Integration
- **JIRA Email**: Your Atlassian account email
- **JIRA API Token**: API token from Atlassian (see Requirements above)
- **JIRA Base URL**: Your JIRA instance URL (default: `https://hpe.atlassian.net`)
- **Green Team Board ID**: JIRA board for Green Team (default: `214`)
- **JIRA Project Key**: Project key for work items (default: `GLCP`)

### Meeting Detection
- **Standup Keywords**: Keywords to identify standup meetings (default: `Green Standup`)

### Voice Speaker Identification
- **Voice Service Enabled**: Toggle voice-based speaker attribution for `.whisper` transcripts (default: enabled)
- **Voice Service Binary Path**: Full path to the `whisper-speaker-id` binary (default: `whisper-speaker-id`)
- **Voice Service Port**: HTTP port for the daemon (default: `8765`)
- **Voice Service Auto-Start**: Auto-spawn the daemon if it isn't already running (default: enabled)
- **MacWhisper Transcripts Directory**: Source folder MacWhisper drops `.whisper` files into, used to auto-locate the matching file for a meeting (default: `~/Documents/Mac Whisper/Meeting Transcripts`)

## Development

### Building

```bash
npm install
npm run dev    # Watch mode
npm run build  # Production build
```

### After Code Changes

1. Run `npm run build`
2. Reload Obsidian: `Cmd+R` (or Command Palette → "Reload app without saving")
3. No full restart needed

### Project Structure

```
obsidean-meeting/
├── main.ts                      # Plugin entry point
├── src/
│   ├── copilot-client.ts        # Copilot CLI wrapper (spawns `copilot -p`)
│   ├── meeting-router.ts        # Route to handlers
│   ├── validators.ts            # File-type validation & team/mode detection
│   ├── skill-loader.ts          # Loads the 3 active skill files
│   ├── people-manager.ts        # People profile create/lookup
│   ├── email-parser.ts          # Email-chain participant extraction
│   ├── output-cleaner.ts        # Strips AI preamble/fences from CLI output
│   ├── voice-analysis-client.ts     # HTTP client for the whisper-speaker-id daemon
│   ├── voice-speaker-resolver.ts    # Resolves .whisper files for a meeting; drives voice-ID flow
│   ├── speaker-resolver.ts          # Text-heuristic speaker/attendee extraction from transcripts
│   ├── handlers/
│   │   ├── general.ts           # General meeting handler
│   │   ├── standup.ts           # Standup meeting handler
│   │   ├── email.ts             # Email-chain handler
│   │   └── daily-summary.ts     # Daily note summary handler
│   ├── transcript/              # 7 transcript cleaners + format detector
│   ├── jira/                    # JIRA REST client, sprint query, formatter
│   └── ui/
│       ├── status-bar.ts                    # Status bar component
│       ├── settings-tab.ts                  # Settings UI
│       ├── copilot-working-modal.ts         # "AI working…" progress modal
│       └── voice-speaker-attribution-modal.ts  # Speaker-ID confirm dialog (with audio playback)
└── skills/                      # Editable AI skill definitions (3 active)
    ├── summary-generation.md
    ├── email-summary.md
    └── daily-summary.md
```

Six other skill files (`meeting-router`, `general-meeting`, `standup-meeting`,
`transcript-cleanup`, `jira-population`, `attendee-extraction`) are no longer
loaded — their logic has been hard-coded in TypeScript. They're kept as design
notes under `docs/legacy-skills/`.

## Skills System

The plugin uses markdown files in the `skills/` directory to define AI behavior
for the 3 prompts that still delegate to a skill file (`summary-generation`,
`email-summary`, `daily-summary`). This allows:
- **Easy editing**: Copilot CLI can modify skills to improve behavior
- **No rebuild**: Changes take effect without recompiling the plugin
- **Version control**: Skills are tracked alongside code
- **Transparency**: See exactly what instructions the AI receives

See `docs/REFERENCE.md` for the full architecture and workflow reference.

## Troubleshooting

### Plugin won't load
- Check Obsidian version (must be 1.0+)
- Check console for errors (Cmd+Option+I)
- Verify plugin files are in correct location

### Copilot CLI not found
- Install: `npm install -g @github/copilot-cli`
- Authenticate: `gh auth login` and enable Copilot
- Or specify full path in settings (e.g., `/Users/you/.nvm/versions/node/v25.2.1/bin/copilot`)

### JIRA integration not working
- Verify JIRA email and API token in settings
- Get token from: https://id.atlassian.com/manage-profile/security/api-tokens
- Check board IDs match your team's boards
- Check console (Cmd+Option+I) for detailed error messages

### Vision extraction not working
- Ensure Copilot CLI is installed and authenticated
- Check that images are referenced with `![[SCR-filename.png]]` format
- Images should be in vault (can be in Media folder or meeting folder)
- Falls back to content extraction if vision fails

### Transcript cleaning issues
- Supported formats: 3 Teams paste/export variants, Google Recorder, generic fallback, MacWhisper JSON, MacWhisper `.whisper` (7 total — see `docs/REFERENCE.md` §4)
- Cleaning only happens if no "Copilot Summary" section exists
- Can be disabled in settings (Processing Preferences)

### People profiles not being created
- Check "Auto-create People Profiles" setting
- Profiles are created in the configured People folder
- Format: `Last, First.md` with frontmatter and aliases

## Roadmap

- [x] Complete Copilot CLI integration
- [x] Implement all 7 transcript cleaning formats
- [x] Add attendee extraction from screenshots
- [x] Complete JIRA integration with auto-checkbox
- [x] Add summary generation
- [x] Add People profile management
- [x] Add user preferences for toggling features
- [x] Add email-chain note processing
- [x] Add daily-summary note generation
- [x] Add voice-based speaker identification (`whisper-speaker-id` daemon) with audio playback in the confirmation dialog
- [ ] Add hotkey customization
- [ ] Add transcript format selection UI
- [ ] Submit to Obsidian Community Plugins
- [ ] Add batch processing for multiple meetings
- [ ] Add custom meeting type detection

## Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) file for details

## Support

- **Issues**: [GitHub Issues](https://github.com/ketronkowski/obsidean-meeting/issues)
- **Discussions**: [GitHub Discussions](https://github.com/ketronkowski/obsidean-meeting/discussions)

## Credits

Created by [Kevin Tronkowski](https://github.com/ketronkowski)

Built with:
- [Obsidian API](https://github.com/obsidianmd/obsidian-api)
- [GitHub Copilot CLI](https://github.com/github/copilot-cli)
- TypeScript & esbuild
