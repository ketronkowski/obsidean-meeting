# JIRA Population Skill

## Purpose
Query active sprint issues from JIRA boards and populate standup meeting notes with formatted issue lists.

## Input
- Board ID (214 for Green, 331 for Magenta)
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
- ✅ Task
- 🎯 Epic
- 📝 Subtask

### Status Display
Include current status: `[To Do]`, `[In Progress]`, `[Code Review]`, `[Done]`, etc.

### Links
Include direct links to JIRA: `https://hpe.atlassian.net/browse/{KEY}`

## Output Format

```markdown
## JIRA

### John Smith
- [ ] 📋 **GLCP-12345** - Implement user authentication [In Progress] [🔗](https://hpe.atlassian.net/browse/GLCP-12345)
- [ ] 🐛 **GLCP-12346** - Fix login redirect bug [To Do] [🔗](https://hpe.atlassian.net/browse/GLCP-12346)

### Jane Doe
- [ ] ✅ **GLCP-12347** - Update deployment docs [Code Review] [🔗](https://hpe.atlassian.net/browse/GLCP-12347)
- [ ] 📋 **GLCP-12348** - Add monitoring dashboard [In Progress] [🔗](https://hpe.atlassian.net/browse/GLCP-12348)

### Unassigned
- [ ] 🐛 **GLCP-12349** - Critical production bug [To Do] [🔗](https://hpe.atlassian.net/browse/GLCP-12349)
```

## Assignee Name Mapping
Map JIRA assignee account IDs to People profile names:
1. Query JIRA for account ID and display name
2. Search People folder for matching profile
3. Use display name from People profile if found
4. Fall back to JIRA display name if no profile match
