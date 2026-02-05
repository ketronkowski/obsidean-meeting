# GitHub Copilot Instructions for obsidean-meeting

## Project Context

This is an Obsidian plugin that automates meeting note processing using the GitHub Copilot SDK. The plugin processes both general meetings and standup meetings with different workflows.

## Architecture

### Core Components
- **main.ts**: Plugin entry point, manages lifecycle
- **copilot-client.ts**: Wrapper for GitHub Copilot SDK
- **meeting-router.ts**: Routes meetings to appropriate handler
- **validators.ts**: Validates meeting files and detects types
- **handlers/**: Contains general and standup meeting processors

### Skills System
The `skills/` directory contains markdown files that define AI behavior:
- Meeting detection logic
- Processing workflows
- Formatting templates
- JIRA integration rules

These are loaded at runtime and can be edited without recompiling.

## Development Guidelines

### Code Style
- Use TypeScript strict mode
- Prefer async/await over promises
- Use Obsidian's Vault API for all file operations
- Keep handlers stateless when possible

### File Operations
Always use Obsidian's API:
```typescript
const file = this.app.workspace.getActiveFile();
const content = await this.app.vault.read(file);
await this.app.vault.modify(file, newContent);
```

Never use Node.js `fs` module directly.

### Error Handling
- Use try-catch in async functions
- Show user-friendly notices for errors
- Log detailed errors to console
- Don't crash the plugin on errors

### Testing Workflow
1. Make changes to TypeScript files
2. Run `npm run build`
3. Reload Obsidian (Cmd+R)
4. Test with a real meeting file

## Current Status

### Implemented ✅
- Plugin scaffold with settings
- Basic meeting validation
- Meeting type detection (standup vs general)
- Status bar integration
- Settings UI with persistence
- Skill file structure
- Handler architecture

### TODO 🚧
- Copilot SDK integration (currently placeholder)
- Transcript cleaning logic (port from Python)
- Attendee extraction with vision
- JIRA integration via MCP
- Summary generation
- People profile creation
- Full error handling

## Integration Points

### GitHub Copilot SDK
When SDK is available, replace placeholder in `copilot-client.ts`:
```typescript
import { CopilotClient } from '@github/copilot-sdk';
```

### Atlassian MCP Server
For JIRA integration, use Copilot's MCP tools:
- Query active sprints
- Get sprint issues
- Add comments to issues

### File Paths
All paths are vault-relative:
- `Meetings/` - Meeting notes
- `People/` - People profiles
- `Media/` - Images and attachments

## Common Tasks

### Adding a New Setting
1. Add to `MeetingProcessorSettings` interface
2. Add to `DEFAULT_SETTINGS`
3. Add UI in `MeetingProcessorSettingTab.display()`
4. Use in relevant handlers

### Adding a New Skill
1. Create markdown file in `skills/`
2. Document purpose, logic, and format
3. Reference in handler code
4. Test skill behavior

### Debugging
1. Open Obsidian dev tools (Cmd+Option+I)
2. Check console for logs
3. Use `console.log()` liberally
4. Test with various meeting formats

## Dependencies

- **obsidian**: Obsidian plugin API
- **@github/copilot-sdk**: GitHub Copilot SDK (when available)
- **esbuild**: Build tool
- **typescript**: Language

## Resources

- [Obsidian Plugin API](https://github.com/obsidianmd/obsidian-api)
- [Obsidian Sample Plugin](https://github.com/obsidianmd/obsidian-sample-plugin)
- [GitHub Copilot SDK Docs](https://github.com/github/copilot-sdk)
