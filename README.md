# Meeting Processor Plugin for Obsidian

Automate your meeting note processing with AI-powered workflows. This Obsidian plugin integrates with GitHub Copilot to process both standup and general meeting notes with a single click.

## Features

- **One-Click Processing**: Process meeting notes with a ribbon button or command palette
- **Smart Meeting Detection**: Automatically detects standup vs. general meetings
- **Attendee Extraction**: Extract attendees from Teams screenshots using vision AI
- **Transcript Cleaning**: Automatically clean transcripts from 4 different formats
- **AI-Powered Summaries**: Generate concise meeting summaries
- **JIRA Integration**: Auto-populate standup notes with active sprint issues
- **Configurable**: Customize paths, models, and team settings

## Requirements

- **Obsidian** 1.0 or higher
- **GitHub Copilot CLI** installed and authenticated
- **Atlassian MCP Server** configured (for JIRA integration)
- **GitHub Copilot SDK** (will be bundled with the plugin)

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

### Processing a Meeting

1. Open a meeting note in Obsidian
2. Click the brain icon in the ribbon, OR
3. Open Command Palette (Cmd+P) and run "Process Meeting"

### Meeting File Requirements

Your meeting notes must:
- Be located in the configured Meetings folder (default: `Meetings/`)
- Follow the naming pattern: `YYYY-MM-DD - {Name}.md`
- Have `meeting` tag in frontmatter
- Example: `2026-02-05 - Product Planning.md`

### Meeting Types

#### General Meetings
Any meeting that doesn't match standup keywords.

**Processing workflow:**
1. Extract attendees from screenshots or content
2. Clean transcript (if no Copilot Summary exists)
3. Generate summary

#### Standup Meetings
Meetings with "Green Standup" or "Magenta Standup" in the filename.

**Pre-meeting mode** (no transcript):
1. Populate JIRA section with active sprint issues
2. Add expected attendees

**Post-meeting mode** (transcript present):
1. Process attendees
2. Clean transcript (if needed)
3. Generate summary
4. Extract JIRA updates from content

## Configuration

Go to Settings → Community Plugins → Meeting Processor

### AI Settings
- **Model**: Select AI model (Claude Sonnet 4, GPT-4.1, etc.)

### Vault Paths
- **Meetings Folder**: Where meeting notes are stored (default: `Meetings`)
- **People Folder**: Where people profiles are stored (default: `People`)
- **Media Folder**: Where attachments are stored (default: `Media`)
- **Templates Folder**: Where templates are stored (default: `Templates`)

### JIRA Integration
- **Green Team Board ID**: JIRA board for Green Team (default: `214`)
- **Magenta Team Board ID**: JIRA board for Magenta Team (default: `331`)
- **JIRA Project Key**: Project key for work items (default: `GLCP`)

### Meeting Detection
- **Standup Keywords**: Keywords to identify standup meetings (default: `Green Standup, Magenta Standup`)

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
│   ├── copilot-client.ts        # Copilot SDK wrapper
│   ├── meeting-router.ts        # Route to handlers
│   ├── validators.ts            # Meeting validation
│   ├── handlers/
│   │   ├── general.ts           # General meeting handler
│   │   └── standup.ts           # Standup meeting handler
│   ├── transcript/              # Transcript cleaning
│   ├── people/                  # Attendee management
│   ├── jira/                    # JIRA integration
│   └── ui/
│       ├── status-bar.ts        # Status bar component
│       └── settings-tab.ts      # Settings UI
└── skills/                      # Editable AI skill definitions
    ├── meeting-router.md
    ├── general-meeting.md
    ├── standup-meeting.md
    ├── transcript-cleanup.md
    ├── summary-generation.md
    ├── jira-population.md
    └── attendee-extraction.md
```

## Skills System

The plugin uses markdown files in the `skills/` directory to define AI behavior. This allows:
- **Easy editing**: Copilot CLI can modify skills to improve behavior
- **No rebuild**: Changes take effect without recompiling the plugin
- **Version control**: Skills are tracked alongside code
- **Transparency**: See exactly what instructions the AI receives

## Troubleshooting

### Plugin won't load
- Check Obsidian version (must be 1.0+)
- Check console for errors (Cmd+Option+I)
- Verify plugin files are in correct location

### "Copilot SDK integration pending" error
- This is expected in early versions
- SDK integration is in progress
- Watch for updates

### JIRA integration not working
- Verify Atlassian MCP server is configured
- Check board IDs in settings
- Verify JIRA authentication

### Transcript cleaning issues
- Check that transcript is in a recognized format
- Try manual format selection (coming in future version)
- Report format examples for improvement

## Roadmap

- [ ] Complete Copilot SDK integration
- [ ] Implement all transcript cleaning formats
- [ ] Add attendee extraction from screenshots
- [ ] Complete JIRA integration
- [ ] Add summary generation
- [ ] Add hotkey customization
- [ ] Add transcript format selection UI
- [ ] Submit to Obsidian Community Plugins

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
- [GitHub Copilot SDK](https://github.com/github/copilot-sdk)
- TypeScript & esbuild
