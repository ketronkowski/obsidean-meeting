# Summary Generation Skill

## Purpose
Generate concise, actionable meeting summaries from transcript or meeting content.

## Input
Either:
- Cleaned transcript from `## Transcript` section
- Existing `## Copilot Summary` content
- Other meeting content if transcript unavailable

## Analysis Points
Extract and summarize:

### 1. Key Discussion Topics
What was discussed? Main themes and subjects.

### 2. Decisions Made
Any decisions reached during the meeting.

### 3. Action Items
Tasks assigned with owners (if identifiable).

### 4. Follow-up Items
Items that need further discussion or investigation.

### 5. Important Information
Key facts, dates, commitments shared.

## Output Format

```markdown
# Transcript Summary

**Key Points:**
- Discussion point 1
- Discussion point 2

**Decisions:**
- Decision 1
- Decision 2

**Action Items:**
- [ ] Action item 1 (Owner: Name)
- [ ] Action item 2

**Follow-up:**
- Follow-up item 1
- Follow-up item 2
```

## Style Guidelines
- Be concise and clear
- Use bullet points for readability
- Include context when needed
- Preserve important details
- Format action items as checkboxes
- Include owner names when mentioned
- Highlight critical deadlines or dates
