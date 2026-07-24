# Daily Summary Skill

## Purpose
Generate a comprehensive daily work summary by aggregating meeting notes, general notes, and conversations from a specific day.

## Workflow

### Input
You will be given the content of a daily note along with the full text of any meeting notes and general notes linked to that day. The content is separated by `---` dividers and labelled by type (Meeting, Note, Short Conversations and Notes).

### Analysis Steps
1. Read all provided meeting notes — extract decisions, outcomes, and action items
2. Read all provided general notes and email chains — extract key discussions and follow-ups
3. Read the "Short Conversations and Notes" section for informal context
4. Identify common themes and priorities across all content
5. Attribute action items to specific people where mentioned

## Output Format

### Format Guidelines
- Use `###` level headings for sections within the summary
- Use bullet points throughout — NOT narrative paragraphs
- Keep bullets concise and scannable (one idea per bullet)
- Focus on outcomes and decisions, not just meeting attendance
- Link to people using `[[Last, First|First Last]]` format when full names are recognized
- Include ONLY sections that have relevant content — omit empty sections entirely

### Section Structure
Generate only the content that belongs inside `## Daily Summary`. Do NOT include the `## Daily Summary` heading itself. Use this structure, including only sections with content:

```
### Key Decisions
- [Decision made] based on [context]
- [Approved/cancelled/changed]: [what and why]

### Project Updates
- **[Project/Team Name]**: [Brief status]
  - Completed: [specific accomplishments]
  - Blocked: [blockers, if any]
  - Next steps: [planned actions]

### Technical Work
- [Technical update, milestone, or environment change]

### Action Items & Follow-ups
- [Person] to [action] by [timeframe]
- Outstanding: [pending items needing follow-up]

### Strategic Discussions
- Discussed [topic] with [people]
- Options considered: [brief list]
- Direction: [outcome or preference]
```

## Handling Sparse Days
- Still generate a summary section even if content is minimal
- When there are no meetings, note "No meetings today" briefly
- When "Short Conversations and Notes" has only a placeholder (`-`), omit that section
- A brief, accurate summary is more useful than an empty section
