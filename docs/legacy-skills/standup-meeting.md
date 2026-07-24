# Standup Meeting Processing Skill

> **Legacy design note — not loaded by the plugin.** This skill file is no longer read by `SkillLoader.getSkill()`; the logic it describes has been hard-coded in TypeScript. Kept for historical/design reference only. See `docs/REFERENCE.md` §10.

## Purpose
Process standup meeting notes with JIRA integration and team-specific workflows.

## Team Detection
- **Green Team**: Board ID 214

Detect from filename containing "Green"

## Mode Detection

### Pre-Meeting Mode
Triggered when `# Transcript` section is empty or minimal (<50 chars)

**Actions:**
1. Query active sprint issues from JIRA board
2. Group issues by assignee
3. Format JIRA section with:
   - Checkboxes for status tracking
   - Type icons (📋 Story, 🐛 Bug, ☑️ Task, 🎯 Epic, 📝 Subtask)
   - Status emoji
   - Links to JIRA items
4. Populate expected attendees from recent standups

### Post-Meeting Mode
Triggered when `# Transcript` section has content (>50 chars)

**Actions:**
1. Process attendees (screenshot or expected list)
2. Clean transcript (unless `# Copilot Summary` exists)
3. Generate meeting summary
4. Extract JIRA key mentions (e.g., GLCP-12345)
5. Add update comments to mentioned JIRA items

## JIRA Section Format

```markdown
# JIRA

### [Assignee Name] (2)
- [ ] 📋 🟢 [GLCP-12345](https://hpe.atlassian.net/browse/GLCP-12345) - Story title (In Progress)
- [ ] 🐛 🔵 [GLCP-12346](https://hpe.atlassian.net/browse/GLCP-12346) - Bug title (To Do)
```

## Output
Update standup file with:
- Populated `# JIRA` section (pre-meeting)
- Expected attendees (pre-meeting)
- Actual attendees (post-meeting)
- Cleaned transcript (post-meeting, if applicable)
- Summary (post-meeting)
- JIRA comments added for mentioned items
