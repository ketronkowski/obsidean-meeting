# JIRA Population Skill

> **Legacy design note — not loaded by the plugin.** This skill file is no longer read by `SkillLoader.getSkill()`; the logic it describes has been hard-coded in TypeScript. Kept for historical/design reference only. See `docs/REFERENCE.md` §10.

## Purpose
Query active sprint issues from JIRA boards and populate standup meeting notes with formatted issue lists.

## Input
- Board ID (214 for Green)
- Active sprint ID (query dynamically)

## Query Logic

### 1. Get Active Sprint
Query the board to find the currently active sprint.

### 2. Get Sprint Issues
Query all issues in the active sprint assigned to any team member.

### 3. Group by Assignee
Organize issues by assignee name for easy standup reference.

## Formatting

### Issue Type Icons
- 📋 Story
- 🐛 Bug
- ☑️ Task
- 🎯 Epic
- 📝 Subtask
- 📌 Other/unknown types

### Status Display
Status emoji prefixes the issue line based on JIRA status name:
- ✅ Done / Closed / Resolved
- 🟢 In Progress / In Development
- 🟡 In Review / Testing
- 🔴 Blocked
- 🔵 To Do / other

### Links
Include direct links to JIRA: `https://hpe.atlassian.net/browse/{KEY}`

## Output Format

```markdown
# JIRA

### John Smith (2)
- [ ] 📋 🟢 [GLCP-12345](https://hpe.atlassian.net/browse/GLCP-12345) - Implement user authentication (In Progress)
- [ ] 🐛 🔵 [GLCP-12346](https://hpe.atlassian.net/browse/GLCP-12346) - Fix login redirect bug (To Do)

### Jane Doe (2)
- [ ] ☑️ 🟡 [GLCP-12347](https://hpe.atlassian.net/browse/GLCP-12347) - Update deployment docs (Code Review)
- [ ] 📋 🟢 [GLCP-12348](https://hpe.atlassian.net/browse/GLCP-12348) - Add monitoring dashboard (In Progress)

### Unassigned (1)
- [ ] 🐛 🔵 [GLCP-12349](https://hpe.atlassian.net/browse/GLCP-12349) - Critical production bug (To Do)
```

Real formatting logic lives in `src/jira/formatter.ts` (`JiraFormatter`). Assignees
are sorted alphabetically with "Unassigned" always last; each assignee heading is
`### {Assignee} ({count})`.

## Assignee Name Mapping
Map JIRA assignee account IDs to People profile names:
1. Query JIRA for account ID and display name
2. Search People folder for matching profile
3. Use display name from People profile if found
4. Fall back to JIRA display name if no profile match
